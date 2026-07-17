{
  pkgs,
  ...
}:

{
  packages = [
    pkgs.git
    pkgs.prek
  ];

  languages.rust = {
    enable = true;
    channel = "stable";
  };

  languages.javascript = {
    enable = true;
    # nixpkgs nodejs_24 24.15/24.16 crashes worker_threads workloads on Darwin
    # (NixOS/nixpkgs#536039); Node 26 ships the upstream V8 fix.
    package = pkgs.nodejs_26;
    corepack.enable = false;
    pnpm = {
      enable = true;
      install.enable = true;
    };
  };
  languages.typescript.enable = true;

  git-hooks = {
    package = pkgs.prek;
    hooks = {
      format-check = {
        enable = true;
        name = "Check formatting and imports";
        entry = "pnpm format:check";
        files = "(^|/)(biome\\.json|package\\.json)$|\\.(css|cjs|js|json|jsonc|jsx|mjs|ts|tsx)$";
        pass_filenames = false;
      };

      lint = {
        enable = true;
        name = "Lint";
        entry = "pnpm lint";
        files = "(^|/)(eslint\\.config\\.cjs|package\\.json)$|\\.(cjs|js|json|jsonc|jsx|mjs|ts|tsx)$";
        pass_filenames = false;
      };

      typecheck = {
        enable = true;
        name = "Typecheck";
        entry = "pnpm typecheck";
        files = "(^|/)(package\\.json|pnpm-lock\\.yaml|pnpm-workspace\\.yaml|tsconfig[^/]*\\.json|turbo\\.json)$|\\.(ts|tsx)$";
        pass_filenames = false;
      };

      # Reject newly added files over 512 KB so baked PNGs / stray binaries can't bloat history.
      # Vector/.icon sources and optimized icons stay well under this; raise per-file via Git LFS if ever needed.
      check-added-large-files = {
        enable = true;
        args = [ "--maxkb=512" ];
      };
    };
  };

  enterShell = ''
    pre_commit_hook="$(git rev-parse --git-path hooks/pre-commit 2>/dev/null || true)"
    if [ -n "$pre_commit_hook" ] && [ ! -x "$pre_commit_hook" ]; then
      echo "pre-commit hook is not installed. Run: devenv shell"
    fi
  '';

  # The dev daemon and desktop run under a `dev` profile so they fork their own universe
  # (~/.linkcode-dev) instead of sharing the default `~/.linkcode`:19523 with an installed release:
  # sharing it lets whichever daemon binds first win, and the loser's client then dials a peer on a
  # different WIRE_PROTOCOL_VERSION — every frame is silently dropped and surfaces as "Unable to
  # connect to the daemon". The env is scoped to these dev commands (not the whole shell) so it never
  # leaks into `pnpm test` / E2E / packaging.
  scripts.daemon.exec = "pnpm run --filter @linkcode/daemon build:rust && LINKCODE_PROFILE=dev pnpm run --filter @linkcode/daemon dev";
  scripts.desktop.exec = "LINKCODE_PROFILE=dev pnpm run --filter @linkcode/desktop dev";
  scripts.mobile.exec = "pnpm run --filter @linkcode/mobile ios";
  scripts.app.exec = "pnpm run --filter @linkcode/daemon build:rust && LINKCODE_PROFILE=dev pnpm --filter @linkcode/daemon --filter @linkcode/desktop --parallel dev";
}

{
  pkgs,
  ...
}:

{
  dotenv.disableHint = true;

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
    package = pkgs.nodejs_26;
    corepack.enable = false;
    pnpm = {
      enable = true;
      # Orb setup owns the frozen install; shell activation must stay side-effect free.
      install.enable = false;
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

  scripts.daemon.exec = "pnpm run --filter @linkcode/daemon build:rust && LINKCODE_PROFILE=dev pnpm run --filter @linkcode/daemon dev";
  scripts.desktop.exec = "LINKCODE_PROFILE=dev pnpm run --filter @linkcode/desktop dev";
  scripts.mobile.exec = "pnpm run --filter @linkcode/mobile ios";
  scripts.app.exec = "pnpm run --filter @linkcode/daemon build:rust && LINKCODE_PROFILE=dev pnpm --filter @linkcode/daemon --filter @linkcode/desktop --parallel dev";
}

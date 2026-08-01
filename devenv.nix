{
  pkgs,
  ...
}:

{
  dotenv.disableHint = true;

  packages = [
    pkgs.git
    pkgs.prek
  ]
  # Mobile UI e2e drives the iOS simulator, which only exists on macOS; Linux CI would pull the
  # JVM closure for nothing. Pinned here rather than installed per-machine so the driver version
  # is part of the toolchain like every other tool.
  ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [ pkgs.maestro ];

  languages.rust = {
    enable = true;
    # Version and components come from rust-toolchain.toml so devenv, rustup, and CI agree.
    toolchainFile = ./rust-toolchain.toml;
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

  # No LINKCODE_PROFILE here: the development channel now owns its own state dir, workspaces, and
  # asset store (CODE-460), so a local run can never contend with an installed release. Pass
  # --profile / LINKCODE_PROFILE yourself only to fork a second universe within this channel.
  scripts.daemon.exec = "pnpm run --filter @linkcode/daemon build:rust && pnpm run --filter @linkcode/daemon dev";
  scripts.desktop.exec = "pnpm run --filter @linkcode/desktop dev";
  # xcodebuild honours the same CC/LD/SDKROOT names this shell exports for the Rust toolchain, so it
  # would compile iOS pods with nix clang and link with `ld` instead of the clang driver. Strip them.
  scripts.mobile.exec = ''
    export PATH="/usr/bin:$PATH" SENTRY_DISABLE_AUTO_UPLOAD=true
    unset DEVELOPER_DIR SDKROOT CC CXX LD NIX_CFLAGS_COMPILE NIX_LDFLAGS MACOSX_DEPLOYMENT_TARGET
    pnpm run --filter @linkcode/mobile ios
  '';
  scripts.app.exec = "pnpm run --filter @linkcode/daemon build:rust && pnpm --filter @linkcode/daemon --filter @linkcode/desktop --parallel dev";
}

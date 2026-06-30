{
  pkgs,
  ...
}:

{
  packages = [
    pkgs.git
    pkgs.prek
  ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    corepack.enable = false;
    pnpm = {
      enable = true;
      install.enable = true;
    };
  };

  git-hooks = {
    package = pkgs.prek;
    hooks = {
      format-check = {
        enable = true;
        name = "Check formatting and imports";
        entry = "pnpm format:check";
        pass_filenames = false;
      };

      lint = {
        enable = true;
        name = "Lint";
        entry = "pnpm lint";
        pass_filenames = false;
      };

      typecheck = {
        enable = true;
        name = "Typecheck";
        entry = "pnpm typecheck";
        pass_filenames = false;
      };
    };
  };

  enterShell = ''
    pre_commit_hook="$(git rev-parse --git-path hooks/pre-commit 2>/dev/null || true)"
    if [ -n "$pre_commit_hook" ] && [ ! -x "$pre_commit_hook" ]; then
      echo "pre-commit hook is not installed. Run: devenv shell"
    fi
  '';

  scripts.daemon.exec = "pnpm run --filter @linkcode/daemon dev";
  scripts.desktop.exec = "pnpm run --filter @linkcode/desktop dev";
  scripts.app.exec = "pnpm --filter @linkcode/daemon --filter @linkcode/desktop --parallel dev";
}

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
    pnpm.enable = true;
  };

  scripts.daemon.exec = "pnpm run --filter @linkcode/daemon dev";
  scripts.desktop.exec = "pnpm run --filter @linkcode/desktop dev";
  scripts.app.exec = "pnpm --filter @linkcode/daemon --filter @linkcode/desktop --parallel dev";
}

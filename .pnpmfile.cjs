'use strict';

/**
 * drizzle-orm declares expo-sqlite as an optional peer. With the mobile app's expo tree installed
 * in this workspace, pnpm resolves that peer and keys the workspace's drizzle-orm instance with
 * the whole expo/react-native suffix. Nothing in the desktop/daemon graph loads that driver
 * (better-sqlite3 is the only one in use), but the satisfied edge drags an expo ↔ @expo/cli
 * dependency cycle into `pnpm list --prod` for apps/desktop, which electron-builder's collector
 * mishandles (pnpm#10601 dedup + cycle → packages silently dropped from the asar, e.g. js-yaml —
 * the packaged app then crashes on launch). It would also make `pnpm deploy` materialize the expo
 * tree into the desktop artifact. Severing the edge only changes peer-resolution metadata; no
 * runtime require path changes.
 */
function readPackage(pkg) {
  if (pkg.name === 'drizzle-orm') {
    if (pkg.peerDependencies) delete pkg.peerDependencies['expo-sqlite'];
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta['expo-sqlite'];
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };

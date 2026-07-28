import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const PI_SDK_PACKAGE = '@earendil-works/pi-coding-agent';

/**
 * Whether the pi SDK would self-resolve out of node_modules — true in dev/standalone daemons,
 * false in packaged apps, which exclude the pi closure and rely on the managed store install
 * (CODE-219). Checks directory presence instead of `require.resolve` because the SDK's `exports`
 * map rejects bare CJS resolution.
 */
export function piSdkPresent(): boolean {
  const paths = createRequire(import.meta.url).resolve.paths(PI_SDK_PACKAGE) ?? [];
  return paths.some((dir) => existsSync(join(dir, PI_SDK_PACKAGE, 'package.json')));
}

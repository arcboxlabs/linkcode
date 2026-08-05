// Build-time immutable config: scripts/render-config-bundle.mts writes the raw bundle from the
// pinned publisher render. It is the single generated source of truth: vite.main.config.mts
// validates it with the frozen v1 loader, derives the inlined bootstrap from the validated object
// in-process, and stages the exact bytes it parsed. Any ambient MAIN_VITE_CONFIG_BOOTSTRAP is a
// hard error — generated output cannot be overridden.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  configBuildBundleDefaults,
  parseConfigBuildBundle,
} from '../../../packages/foundation/common/src/config/build-bundle'; // eslint-disable-line import-x/no-relative-packages -- Vite must inline this source dependency.

export interface GeneratedConfigBundle {
  readonly bootstrapJson: string;
  readonly bundleText: string;
}

export function loadGeneratedConfigBundle(
  desktopDir: string,
  env: Readonly<Partial<Record<string, string>>>,
): GeneratedConfigBundle | null {
  const bundlePath = resolve(desktopDir, 'generated/config-build-bundle.json');
  if (!existsSync(bundlePath)) {
    if (env.LINKCODE_REQUIRE_CONFIG_BUNDLE === '1') {
      throw new Error(
        'LINKCODE_REQUIRE_CONFIG_BUNDLE=1 but apps/desktop/generated has no bundle — run ' +
          '`pnpm -F @linkcode/desktop config:render` with pinned inputs before building',
      );
    }
    return null;
  }
  if (env.MAIN_VITE_CONFIG_BOOTSTRAP) {
    throw new Error(
      'MAIN_VITE_CONFIG_BOOTSTRAP must not be set when a generated config bundle exists; ' +
        'the generated bootstrap is immutable',
    );
  }
  const bundleText = readFileSync(bundlePath, 'utf8');
  const bundle = parseConfigBuildBundle(JSON.parse(bundleText));
  if (bundle.platform !== 'desktop') {
    throw new Error(`generated config bundle targets ${bundle.platform}, expected desktop`);
  }
  // Same shape as DesktopConfigBootstrap (src/main/config.ts); parseBootstrap revalidates it at
  // runtime after Vite inlines it into the main bundle.
  const bootstrap = {
    brandId: bundle.brandId,
    channel: bundle.channel,
    defaults: configBuildBundleDefaults(bundle),
    emergencyEndpoint: bundle.endpoints.emergency,
    emergencyPublicKeys: bundle.keyrings.emergency,
    endpoint: bundle.endpoints.normal,
    maximumSchemaVersion: bundle.maximumSchemaVersion,
    publicKeys: bundle.keyrings.normal,
    telemetryEndpoint: bundle.endpoints.telemetry,
  };
  return { bootstrapJson: JSON.stringify(bootstrap), bundleText };
}

/**
 * Stages the exact parsed bundle bytes into out/config (packed into the asar as the provenance
 * record). A rebuild without a rendered bundle must not retain a stale staged copy from a
 * previous build (Vite clears out/main, not out/config).
 */
export function stageConfigBundle(
  desktopDir: string,
  generated: GeneratedConfigBundle | null,
): void {
  const outConfig = resolve(desktopDir, 'out/config');
  rmSync(outConfig, { recursive: true, force: true });
  if (!generated) return;
  mkdirSync(outConfig, { recursive: true });
  writeFileSync(resolve(outConfig, 'build-bundle.json'), generated.bundleText);
}

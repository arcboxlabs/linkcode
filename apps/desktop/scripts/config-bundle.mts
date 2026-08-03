// Build-time immutable config: scripts/render-config-bundle.mts writes the raw bundle from the
// pinned publisher render. It is the single generated source of truth: vite.main.config.mts
// validates it with the frozen v1 loader, derives the inlined bootstrap from the validated object
// in-process, and stages the exact bytes it parsed. Any ambient MAIN_VITE_CONFIG_BOOTSTRAP is a
// hard error — generated output cannot be overridden.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isObjectEmpty } from 'foxts/is-object-empty';
// Relative on purpose: this module is inlined into the bundled Vite config, which runs under
// plain Node — Node cannot resolve the package's extensionless TS source exports.
import { parseBrandIdentityArtifact } from '../../../packages/foundation/common/src/config/brand-identity';
import {
  configBuildBundleDefaults,
  parseConfigBuildBundle,
} from '../../../packages/foundation/common/src/config/build-bundle'; // eslint-disable-line import-x/no-relative-packages -- Vite must inline this source dependency.

export interface GeneratedConfigBundle {
  readonly bootstrapJson: string;
  /** Present only on white-label renders (config:render --brand-artifacts); the default product
   * never has one and keeps its built-in identity. */
  readonly brandIdentityJson?: string;
  readonly bundleText: string;
}

const CONFORMANCE_FIXTURE_PUBLIC_KEYS = new Set([
  '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
  'PUAXw-hDiVqStwqnTRt-vJyYLM8uxJaMwM1V8Sr0Zgw',
  '_FHNjmIYoaONpH7QAjDwWAgW7RO6MwOsXeuRFUiQgCU',
]);

export function loadGeneratedConfigBundle(
  desktopDir: string,
  env: Readonly<Partial<Record<string, string>>>,
): GeneratedConfigBundle | null {
  const bundlePath = resolve(desktopDir, 'generated/config-build-bundle.json');
  const brandIdentityPath = resolve(desktopDir, 'generated/brand-identity.json');
  if (!existsSync(bundlePath)) {
    if (env.LINKCODE_REQUIRE_CONFIG_BUNDLE === '1') {
      throw new Error(
        'LINKCODE_REQUIRE_CONFIG_BUNDLE=1 but apps/desktop/generated has no bundle — run ' +
          '`pnpm -F @linkcode/desktop config:render` with pinned inputs before building',
      );
    }
    if (existsSync(brandIdentityPath)) {
      throw new Error(
        'apps/desktop/generated has a brand identity but no config bundle — re-run ' +
          '`pnpm -F @linkcode/desktop config:render --brand-artifacts` with pinned inputs',
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
  if (
    Object.values(bundle.keyrings.emergency).some((key) => CONFORMANCE_FIXTURE_PUBLIC_KEYS.has(key))
  ) {
    throw new Error(
      'generated config bundle emergency keyring contains the conformance fixture key',
    );
  }
  if (
    env.LINKCODE_REQUIRE_CONFIG_BUNDLE === '1' &&
    (bundle.endpoints.emergency === null || isObjectEmpty(bundle.keyrings.emergency))
  ) {
    throw new Error(
      'LINKCODE_REQUIRE_CONFIG_BUNDLE=1 requires an emergency endpoint and emergency public key',
    );
  }
  // White-label renders also write the immutable identity artifact; when present it must be the
  // same brand/channel/source as the bundle and no ambient override may exist. Deep validation
  // (parseBrandIdentityArtifact) throws on any malformed or tampered artifact.
  let brandIdentityJson: string | undefined;
  if (existsSync(brandIdentityPath)) {
    if (env.MAIN_VITE_BRAND_IDENTITY) {
      throw new Error(
        'MAIN_VITE_BRAND_IDENTITY must not be set when a generated brand identity exists; ' +
          'the generated brand identity is immutable',
      );
    }
    brandIdentityJson = readFileSync(brandIdentityPath, 'utf8');
    const identity = parseBrandIdentityArtifact(JSON.parse(brandIdentityJson));
    if (identity.platform !== 'desktop') {
      throw new Error(`generated brand identity targets ${identity.platform}, expected desktop`);
    }
    if (
      identity.brandId !== bundle.brandId ||
      identity.channel !== bundle.channel ||
      identity.provenance.sourceGitSha !== bundle.provenance.sourceGitSha
    ) {
      throw new Error(
        `generated brand identity (${identity.brandId}/${identity.channel}) does not match the ` +
          `config bundle (${bundle.brandId}/${bundle.channel}) — re-run ` +
          '`pnpm -F @linkcode/desktop config:render --brand-artifacts`',
      );
    }
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
  return { bootstrapJson: JSON.stringify(bootstrap), brandIdentityJson, bundleText };
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

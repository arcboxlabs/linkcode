// Build-time immutable config: scripts/render-config-bundle.mts writes the raw bundle from the
// pinned publisher render. It is the single generated source of truth: vite.main.config.mts
// validates it with the frozen v1 loader, derives the inlined bootstrap from the validated object
// in-process, and stages the exact bytes it parsed. Any ambient MAIN_VITE_CONFIG_BOOTSTRAP is a
// hard error — generated output cannot be overridden.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
// Relative on purpose: this module is inlined into the bundled Vite config, which runs under
// plain Node — Node cannot resolve the package's extensionless TS source exports.
// eslint-disable-next-line import-x/no-relative-packages -- see above
import { parseBrandIdentityArtifact } from '../../../packages/foundation/common/src/config/brand-identity';
import {
  configBuildBundleDefaults,
  parseConfigBuildBundle,
} from '../../../packages/foundation/common/src/config/build-bundle'; // eslint-disable-line import-x/no-relative-packages -- Vite must inline this source dependency.
import {
  electronBuilderBrandConfig,
  serializeElectronBuilderBrandConfig,
} from '../src/build/electron-builder-brand';

interface GeneratedConfigBundleBase {
  readonly bootstrapJson: string;
  readonly bundleText: string;
}

const CONFORMANCE_FIXTURE_PUBLIC_KEYS = new Set([
  '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
  'PUAXw-hDiVqStwqnTRt-vJyYLM8uxJaMwM1V8Sr0Zgw',
  '_FHNjmIYoaONpH7QAjDwWAgW7RO6MwOsXeuRFUiQgCU',
]);
interface DefaultGeneratedConfigBundle extends GeneratedConfigBundleBase {
  readonly brandBuilderConfigText?: undefined;
  readonly brandIconBytes?: undefined;
  readonly brandIdentityJson?: undefined;
}

interface BrandedGeneratedConfigBundle extends GeneratedConfigBundleBase {
  readonly brandBuilderConfigText: string;
  readonly brandIconBytes: Uint8Array;
  readonly brandIdentityJson: string;
}

export type GeneratedConfigBundle = BrandedGeneratedConfigBundle | DefaultGeneratedConfigBundle;

const DEFAULT_BRAND_ID = 'linkcode';
const BUNDLE_FILE = 'config-build-bundle.json';
const BRAND_IDENTITY_FILE = 'brand-identity.json';
const BRAND_BUILDER_FILE = 'electron-builder.brand.json';
const BRAND_ICON_FILE = 'brand-assets/icon.png';
const collator = new Intl.Collator();

function listFiles(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    collator.compare(a.name, b.name),
  );
  for (let i = 0, len = entries.length; i < len; i++) {
    const entry = entries[i];
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) appendArrayInPlace(files, listFiles(join(dir, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

function assertExactFiles(dir: string, expected: readonly string[], label: string): void {
  const actual = listFiles(dir);
  if (
    actual.length === expected.length &&
    actual.every((file, index) => file === expected[index])
  ) {
    return;
  }
  throw new Error(
    `${label} must contain exactly ${expected.length === 0 ? 'no files' : expected.join(', ')}; ` +
      're-run the matching config render/build before packaging',
  );
}

export function loadGeneratedConfigBundle(
  desktopDir: string,
  env: Readonly<Partial<Record<string, string>>>,
): GeneratedConfigBundle | null {
  if (env.MAIN_VITE_BRAND_IDENTITY) {
    throw new Error(
      'MAIN_VITE_BRAND_IDENTITY must not be set; desktop identity comes only from generated ' +
        'brand artifacts or the built-in default',
    );
  }
  const generatedDir = resolve(desktopDir, 'generated');
  const bundlePath = resolve(generatedDir, BUNDLE_FILE);
  if (!existsSync(bundlePath)) {
    assertExactFiles(generatedDir, [], 'apps/desktop/generated without a config bundle');
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
  if (
    Object.values(bundle.keyrings.emergency).some((key) => CONFORMANCE_FIXTURE_PUBLIC_KEYS.has(key))
  ) {
    throw new Error(
      'generated config bundle emergency keyring contains the conformance fixture key',
    );
  }
  const branded = bundle.brandId !== DEFAULT_BRAND_ID;
  assertExactFiles(
    generatedDir,
    branded
      ? [BRAND_ICON_FILE, BRAND_IDENTITY_FILE, BUNDLE_FILE, BRAND_BUILDER_FILE]
      : [BUNDLE_FILE],
    'apps/desktop/generated',
  );

  let brand:
    | Pick<
        BrandedGeneratedConfigBundle,
        'brandBuilderConfigText' | 'brandIconBytes' | 'brandIdentityJson'
      >
    | undefined;
  if (branded) {
    const brandIdentityJson = readFileSync(resolve(generatedDir, BRAND_IDENTITY_FILE), 'utf8');
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
    const brandBuilderConfigText = readFileSync(resolve(generatedDir, BRAND_BUILDER_FILE), 'utf8');
    const expectedBuilderConfig = serializeElectronBuilderBrandConfig(
      electronBuilderBrandConfig(identity),
    );
    if (brandBuilderConfigText !== expectedBuilderConfig) {
      throw new Error(
        'generated electron-builder brand config does not match brand-identity.json — re-run ' +
          '`pnpm -F @linkcode/desktop config:render --brand-artifacts`',
      );
    }
    brand = {
      brandBuilderConfigText,
      brandIconBytes: readFileSync(resolve(generatedDir, BRAND_ICON_FILE)),
      brandIdentityJson,
    };
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
  const generatedBase = {
    bootstrapJson: JSON.stringify(bootstrap),
    bundleText,
  };
  return brand === undefined ? generatedBase : { ...generatedBase, ...brand };
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
  if (generated.brandIdentityJson === undefined) return;
  writeFileSync(resolve(outConfig, BRAND_IDENTITY_FILE), generated.brandIdentityJson);
  writeFileSync(resolve(outConfig, BRAND_BUILDER_FILE), generated.brandBuilderConfigText);
  mkdirSync(resolve(outConfig, 'brand-assets'), { recursive: true });
  writeFileSync(resolve(outConfig, BRAND_ICON_FILE), generated.brandIconBytes);
}

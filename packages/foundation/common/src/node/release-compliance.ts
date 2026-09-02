import type { ConfigBuildBundle } from '../config';
import { configBuildBundleSnapshot } from '../config';

export interface StoreComplianceDeclaration {
  readonly checklist: Readonly<Record<string, boolean>>;
  readonly disclosedFeatures: readonly string[];
}

const RE_EXECUTABLE_STRING =
  /^\s*(?:#!|javascript:|data:\s*(?:application|text)\/(?:ecmascript|javascript)|data:\s*application\/wasm)|<script\b|\.(?:apk|cjs|dll|dylib|exe|ipa|js|mjs|so|wasm)(?:[?#]|$)/i;
const RE_CAMEL_CASE_BOUNDARY = /([a-z\d])([A-Z])/g;
const RE_KEY_SEGMENT_SPLIT = /[._-]/;
const EXECUTABLE_KEY_TOKENS = new Set([
  'binaries',
  'binary',
  'bundle',
  'code',
  'command',
  'commands',
  'executable',
  'plugin',
  'plugins',
  'script',
  'scripts',
  'wasm',
]);
const STORE_CHECKLIST_KEYS = [
  'configurableFeaturesDisclosed',
  'dataPracticesReviewed',
  'noExecutableCode',
  'permissionsReviewed',
  'storeMetadataReviewed',
] as const;

function configurationKeys(bundle: ConfigBuildBundle): readonly string[] {
  const snapshot = configBuildBundleSnapshot(bundle);
  return [
    ...Object.keys(snapshot.values),
    ...snapshot.overrides.flatMap((override) => Object.keys(override.set)),
    ...Object.keys(snapshot.rollouts),
  ];
}

function configurationKeyTokens(key: string): readonly string[] {
  return key
    .replaceAll(RE_CAMEL_CASE_BOUNDARY, '$1.$2')
    .split(RE_KEY_SEGMENT_SPLIT)
    .map((token) => token.toLowerCase());
}

function assertSafeConfigurationValue(
  value: unknown,
  path: string,
  disclosedFeatures: ReadonlySet<string>,
): void {
  if (typeof value === 'string' && RE_EXECUTABLE_STRING.test(value)) {
    throw new TypeError(`${path} looks like executable code or an executable-code URL`);
  }
  if (Array.isArray(value)) {
    for (let index = 0, len = value.length; index < len; index++) {
      const entry = value[index];
      assertSafeConfigurationValue(entry, `${path}[${index}]`, disclosedFeatures);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const entries = Object.entries(value);
  for (let i = 0, len = entries.length; i < len; i++) {
    const [key, entry] = entries[i];
    const tokens = configurationKeyTokens(key);
    if (tokens.some((token) => EXECUTABLE_KEY_TOKENS.has(token))) {
      throw new TypeError(`${path}.${key} declares an executable-code surface`);
    }
    if (tokens.some((token) => token.startsWith('review')) && !disclosedFeatures.has(key)) {
      throw new TypeError(
        `review configuration key ${path}.${key} is not a disclosed feature/module`,
      );
    }
    assertSafeConfigurationValue(entry, `${path}.${key}`, disclosedFeatures);
  }
}

export function assertStoreCompliance(
  bundle: ConfigBuildBundle,
  declaration: StoreComplianceDeclaration,
): void {
  const checklistKeys = Object.keys(declaration.checklist).sort();
  if (
    checklistKeys.length !== STORE_CHECKLIST_KEYS.length ||
    checklistKeys.some((key, index) => key !== STORE_CHECKLIST_KEYS[index])
  ) {
    throw new TypeError(
      `compliance checklist must contain exactly: ${STORE_CHECKLIST_KEYS.join(', ')}`,
    );
  }
  for (let i = 0, len = STORE_CHECKLIST_KEYS.length; i < len; i++) {
    const key = STORE_CHECKLIST_KEYS[i];
    if (!declaration.checklist[key]) {
      throw new TypeError(`compliance checklist ${key} must be true`);
    }
  }
  const keys = [...new Set(configurationKeys(bundle))].sort();
  const configurableFeatures = keys.filter(
    (key) => key.startsWith('feature.') || key.startsWith('modules.'),
  );
  if (JSON.stringify(configurableFeatures) !== JSON.stringify(declaration.disclosedFeatures)) {
    throw new TypeError(
      `disclosedFeatures must exactly match configurable feature/module keys: ${configurableFeatures.join(', ')}`,
    );
  }
  for (let i = 0, len = keys.length; i < len; i++) {
    const key = keys[i];
    if (configurationKeyTokens(key).some((token) => EXECUTABLE_KEY_TOKENS.has(token))) {
      throw new TypeError(`configuration key ${key} declares an executable-code surface`);
    }
  }
  assertSafeConfigurationValue(
    configBuildBundleSnapshot(bundle),
    'snapshot',
    new Set(configurableFeatures),
  );
}

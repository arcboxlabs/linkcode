import {
  applyConfigPatch,
  canonicalizeJson,
  conditionMatches,
  isConfigKey,
  isValidSemver,
  matchesVersionRange,
  rolloutMatches,
} from './contract';
import { cloneJson } from './i-json';
import type {
  ConfigDefinitions,
  ConfigEmergencyState,
  ConfigEvent,
  ConfigSnapshot,
  ConfigValue,
  ConfigValueDefinition,
  ConfigValues,
  EmergencyDocument,
  EmergencyHostState,
  EvaluationContext,
  JsonValue,
} from './types';
import { ConfigCoreError } from './types';

export function defaultValues<Definitions extends ConfigDefinitions>(
  definitions: Definitions,
): ConfigValues<Definitions> {
  const values: Record<string, ConfigValue> = {};
  const definitionEntries = Object.entries(definitions);
  for (let i = 0, len = definitionEntries.length; i < len; i++) {
    const [key, definition] = definitionEntries[i];
    if (!isConfigKey(key)) throw new ConfigCoreError('schema-invalid', `Invalid known key ${key}`);
    values[key] = parseDefinitionValue(definition, key, definition.defaultValue, `default.${key}`);
    if (key.startsWith('feature.')) {
      const disabled = parseKnownValue(definition.parse, false, `disabled.${key}`);
      if (disabled !== false) {
        throw new ConfigCoreError('schema-invalid', `Known feature ${key} must be boolean`);
      }
    }
  }
  return values as ConfigValues<Definitions>;
}

export function evaluateSnapshot<Definitions extends ConfigDefinitions>(
  snapshot: ConfigSnapshot,
  definitions: Definitions,
  context: EvaluationContext,
  deviceId: string,
  report: ((event: ConfigEvent) => void) | undefined,
): ConfigValues<Definitions> {
  validateKnownValues(snapshot.values, definitions, 'snapshot.values');
  if (
    !isValidSemver(context.appVersion) &&
    snapshot.overrides.some((entry) => entry.when.appVersion !== undefined)
  ) {
    report?.({ type: 'invalid-runtime-app-version', value: context.appVersion });
  }

  let evaluated: Record<string, JsonValue> = { ...snapshot.values };
  for (let i = 0, len = snapshot.overrides.length; i < len; i++) {
    const override = snapshot.overrides[i];
    if (conditionMatches(override.when, context)) {
      evaluated = applyConfigPatch(evaluated, override.set);
    }
  }
  const rolloutEntries = Object.entries(snapshot.rollouts);
  for (let i = 0, len = rolloutEntries.length; i < len; i++) {
    const [key, rollout] = rolloutEntries[i];
    if (rolloutMatches(rollout.salt, deviceId, rollout.basisPoints)) {
      evaluated[key] = rollout.value;
    }
  }

  const values = defaultValues(definitions) as Record<string, ConfigValue>;
  const evaluatedEntries = Object.entries(evaluated);
  for (let i = 0, len = evaluatedEntries.length; i < len; i++) {
    const [key, value] = evaluatedEntries[i];
    const definition = definitionFor(definitions, key);
    if (!definition) continue;
    values[key] = parseDefinitionValue(definition, key, value, key);
  }
  return values as ConfigValues<Definitions>;
}

export function applyEmergency<Definitions extends ConfigDefinitions>(
  values: ConfigValues<Definitions>,
  emergency: EmergencyDocument | null,
  definitions: Definitions,
): ConfigValues<Definitions> {
  const projected = cloneJson(values as ConfigValue) as Record<string, ConfigValue>;
  const disabledFeatures = emergency?.disabledFeatures ?? [];
  for (let i = 0, len = disabledFeatures.length; i < len; i++) {
    const key = disabledFeatures[i];
    if (definitionFor(definitions, key)) projected[key] = false;
  }
  return projected as ConfigValues<Definitions>;
}

/** A missing or unparsable runtime version cannot prove it satisfies the minimum: enforce. */
export function forceMinVersionSatisfied(
  appVersion: string,
  forceMinVersion: string | null,
): boolean {
  if (forceMinVersion === null) return true;
  return isValidSemver(appVersion) && matchesVersionRange(appVersion, `>=${forceMinVersion}`);
}

export function emergencyHostState(
  state: ConfigEmergencyState | null,
  appVersion: string,
): EmergencyHostState | null {
  return state
    ? {
        disabledFeatures: [...state.disabledFeatures],
        emergencyVersion: state.emergencyVersion,
        forceMinVersion: state.forceMinVersion,
        updateRequired: !forceMinVersionSatisfied(appVersion, state.forceMinVersion),
      }
    : null;
}

export function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function validateKnownValues(
  values: Readonly<Record<string, ConfigValue>>,
  definitions: ConfigDefinitions,
  label: string,
): void {
  const valueEntries = Object.entries(values);
  for (let i = 0, len = valueEntries.length; i < len; i++) {
    const [key, value] = valueEntries[i];
    const definition = definitionFor(definitions, key);
    if (definition) parseDefinitionValue(definition, key, value, `${label}.${key}`);
  }
}

function parseDefinitionValue(
  definition: ConfigValueDefinition,
  key: string,
  value: JsonValue,
  label: string,
): ConfigValue {
  const parsed = parseKnownValue(definition.parse, value, label);
  if (typeof parsed !== 'boolean' && key.startsWith('feature.')) {
    throw new ConfigCoreError('schema-invalid', `Known feature ${key} must be boolean`);
  }
  return parsed;
}

function parseKnownValue(
  parse: (value: ConfigValue) => ConfigValue,
  value: JsonValue,
  label: string,
): ConfigValue {
  const configValue = value ?? schemaInvalid(`${label} must not be null`);
  let parsed: ConfigValue;
  try {
    parsed = parse(cloneJson(configValue));
    canonicalizeJson(parsed);
  } catch (error) {
    if (error instanceof ConfigCoreError) throw error;
    throw new ConfigCoreError('schema-invalid', `${label} has the wrong product type`, {
      cause: error,
    });
  }
  return cloneJson(parsed);
}

function definitionFor(
  definitions: ConfigDefinitions,
  key: string,
): ConfigValueDefinition | undefined {
  return Object.hasOwn(definitions, key) ? definitions[key] : undefined;
}

function schemaInvalid(message: string): never {
  throw new ConfigCoreError('schema-invalid', message);
}

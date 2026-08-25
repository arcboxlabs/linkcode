import type { PluginConfigValue } from '@linkcode/client-core';
import type { LinkCodePluginSettingField, LinkCodePluginSettings } from '@linkcode/schema';
import { isObjectEmpty } from 'foxts/is-object-empty';

/** Pure helpers for the manifest-driven plugin settings form. No React, no I/O. */

/** Form values use escaped keys and strings except booleans; secret fields start blank so an
 * untouched secret keeps its stored value. */
export type PluginConfigFormValues = Record<string, string | boolean>;

/** Escape `.` because RHF treats it as a path separator; `$` is forbidden in setting ids and stays
 * a literal path segment. */
export function pluginConfigFormKey(fieldId: string): string {
  return fieldId.replaceAll('.', '$');
}

/** Validation outcome tokens the form maps to translated messages. */
export type PluginConfigFieldError = 'required' | 'invalidNumber';

export function pluginConfigDefaults(
  settings: LinkCodePluginSettings,
  values: Readonly<Record<string, PluginConfigValue>>,
): PluginConfigFormValues {
  const defaults: PluginConfigFormValues = {};
  for (const [fieldId, field] of Object.entries(settings)) {
    const formKey = pluginConfigFormKey(fieldId);
    const stored = values[fieldId];
    if (field.type === 'boolean') {
      defaults[formKey] =
        typeof stored === 'boolean'
          ? stored
          : typeof field.default === 'boolean'
            ? field.default
            : false;
      continue;
    }
    if (field.secret) {
      // Secret values never arrive over the wire; the blank input carries "keep as-is".
      defaults[formKey] = '';
      continue;
    }
    // `in` over indexed access: the masked read may omit keys the index-signature type claims exist.
    if (fieldId in values) {
      defaults[formKey] = String(values[fieldId]);
      continue;
    }
    defaults[formKey] = field.default === undefined ? '' : String(field.default);
  }
  return defaults;
}

/** Validate one raw form value against its declared field; `true` passes. */
export function validatePluginConfigField(
  field: LinkCodePluginSettingField,
  raw: string | boolean,
): true | PluginConfigFieldError {
  if (field.type === 'boolean') return true;
  const value = typeof raw === 'string' ? raw : String(raw);
  if (value === '') {
    // A blank secret is "keep the stored value", never an error.
    return field.required === true && !field.secret ? 'required' : true;
  }
  if (field.type === 'number' && Number.isNaN(Number(value))) return 'invalidNumber';
  return true;
}

/**
 * Per-key patch for `plugin-config.set`, mirroring the custom-MCP masked-edit contract:
 *
 * - `boolean` switches always write (they have a complete value).
 * - `password` fields write only when the user typed something; blank keeps the stored secret.
 * - `string` / `enum` / `number` write their typed value, or remove the key when cleared —
 *   but only if the key had a stored value (removing an absent key would be noise).
 * - A non-secret value equal to the manifest `default` is stored as a removal, not a write:
 *   freezing today's default into config.json would silently win over a future manifest upgrade
 *   that changes the default.
 *
 * The `fieldId in values` guards only suppress noise, and only for fields with no `default`: the
 * masked read folds defaults in, so for a defaulted field the key is present whether or not
 * anything is stored. Removing an already-absent key is a harmless no-op either way.
 */
export function buildPluginConfigPatch(
  settings: LinkCodePluginSettings,
  values: Readonly<Record<string, PluginConfigValue>>,
  form: PluginConfigFormValues,
): { set?: Record<string, PluginConfigValue>; remove?: string[] } {
  const set: Record<string, PluginConfigValue> = {};
  const remove: string[] = [];
  for (const [fieldId, field] of Object.entries(settings)) {
    // The form is keyed by form key; the patch is keyed by setting id. This is the only crossing.
    const formKey = pluginConfigFormKey(fieldId);
    if (!(formKey in form)) continue;
    const raw = form[formKey];
    if (field.type === 'boolean') {
      const typed = raw === true;
      if (field.default !== undefined && typed === field.default) {
        if (fieldId in values) remove.push(fieldId);
      } else {
        set[fieldId] = typed;
      }
      continue;
    }
    const value = typeof raw === 'string' ? raw : String(raw);
    if (value === '') {
      if (!field.secret && fieldId in values) remove.push(fieldId);
      continue;
    }
    const typed = field.type === 'number' ? Number(value) : value;
    if (!field.secret && field.default !== undefined && typed === field.default) {
      if (fieldId in values) remove.push(fieldId);
      continue;
    }
    set[fieldId] = typed;
  }
  return {
    ...(!isObjectEmpty(set) && { set }),
    ...(remove.length > 0 && { remove }),
  };
}

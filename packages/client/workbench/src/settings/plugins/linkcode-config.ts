import type { PluginConfigValue } from '@linkcode/client-core';
import type { LinkCodePluginSettingField, LinkCodePluginSettings } from '@linkcode/schema';
import { isObjectEmpty } from 'foxts/is-object-empty';

/** Pure helpers for the manifest-driven plugin settings form. No React, no I/O. */

/**
 * Form value shape: every control edits a string except `boolean` (a switch). Conversion to the
 * typed wire value happens in {@link buildPluginConfigPatch}. Secret (`password`) fields always
 * start blank — the masked read never returns them, and blank means "keep the stored value".
 */
export type PluginConfigFormValues = Record<string, string | boolean>;

/** Validation outcome tokens the form maps to translated messages. */
export type PluginConfigFieldError = 'required' | 'invalidNumber';

export function pluginConfigDefaults(
  settings: LinkCodePluginSettings,
  values: Readonly<Record<string, PluginConfigValue>>,
): PluginConfigFormValues {
  const defaults: PluginConfigFormValues = {};
  for (const [fieldId, field] of Object.entries(settings)) {
    const stored = values[fieldId];
    if (field.type === 'boolean') {
      defaults[fieldId] =
        typeof stored === 'boolean'
          ? stored
          : typeof field.default === 'boolean'
            ? field.default
            : false;
      continue;
    }
    if (field.secret) {
      // Secret values never arrive over the wire; the blank input carries "keep as-is".
      defaults[fieldId] = '';
      continue;
    }
    // `in` over indexed access: the masked read may omit keys the index-signature type claims exist.
    if (fieldId in values) {
      defaults[fieldId] = String(values[fieldId]);
      continue;
    }
    defaults[fieldId] = field.default === undefined ? '' : String(field.default);
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
 */
export function buildPluginConfigPatch(
  settings: LinkCodePluginSettings,
  values: Readonly<Record<string, PluginConfigValue>>,
  form: PluginConfigFormValues,
): { set?: Record<string, PluginConfigValue>; remove?: string[] } {
  const set: Record<string, PluginConfigValue> = {};
  const remove: string[] = [];
  for (const [fieldId, field] of Object.entries(settings)) {
    if (!(fieldId in form)) continue;
    const raw = form[fieldId];
    if (field.type === 'boolean') {
      set[fieldId] = raw === true;
      continue;
    }
    const value = typeof raw === 'string' ? raw : String(raw);
    if (value === '') {
      if (!field.secret && fieldId in values) remove.push(fieldId);
      continue;
    }
    set[fieldId] = field.type === 'number' ? Number(value) : value;
  }
  return {
    ...(!isObjectEmpty(set) && { set }),
    ...(remove.length > 0 && { remove }),
  };
}

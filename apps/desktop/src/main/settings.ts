import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DesktopSettings, DesktopSettingsPatch } from '@linkcode/ipc';
import { DesktopSettingsSchema } from '@linkcode/ipc';
import { app } from 'electron';

/**
 * System-plane desktop settings store (PLAN §2.3): theme / locale / daemon endpoint, persisted as
 * JSON under `userData`. Read once into memory at first access; every write re-validates the merged
 * result and persists it. Carries no business data — provider config lives in the daemon (data plane).
 */

let cached: DesktopSettings | null = null;

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function load(): DesktopSettings {
  try {
    return DesktopSettingsSchema.parse(JSON.parse(readFileSync(settingsPath(), 'utf8')));
  } catch {
    // Missing or malformed file → defaults (zod fills every field from its schema default).
    return DesktopSettingsSchema.parse({});
  }
}

export function getSettings(): DesktopSettings {
  if (!cached) cached = load();
  return cached;
}

export function setSettings(patch: DesktopSettingsPatch): DesktopSettings {
  const next = DesktopSettingsSchema.parse({ ...getSettings(), ...patch });
  cached = next;
  const file = settingsPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

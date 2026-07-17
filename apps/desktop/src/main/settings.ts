import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DesktopSettings, DesktopSettingsPatch } from '@linkcode/ipc';
import { DesktopSettingsSchema } from '@linkcode/ipc';
import { app } from 'electron';

/**
 * System-plane desktop settings store (docs/ARCHITECTURE.md#core-principles), persisted as JSON
 * under `userData`; read once into memory, every write re-validates the merged result. Carries no
 * business data — provider config lives in the daemon (data plane).
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
  const file = settingsPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  cached = next;
  return next;
}

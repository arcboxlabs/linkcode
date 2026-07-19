import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  const file = settingsPath();
  try {
    const stored: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (stored && typeof stored === 'object' && !('historyImportOnboardingHandled' in stored)) {
      // A settings file predating this onboarding belongs to an existing user. Do not turn a
      // newly-added first-install experience into a surprise migration prompt.
      return DesktopSettingsSchema.parse({ ...stored, historyImportOnboardingHandled: true });
    }
    return DesktopSettingsSchema.parse(stored);
  } catch {
    // No file is a first install. A malformed pre-existing file still belongs to an existing user,
    // so suppress the one-time offer while recovering every other field to its default.
    return DesktopSettingsSchema.parse({ historyImportOnboardingHandled: existsSync(file) });
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

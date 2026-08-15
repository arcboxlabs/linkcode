import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PilotFixtureStep {
  readonly activationVersion: string;
  readonly configVersion: string;
  readonly name: 'baseline' | 'canary-change' | 'roll-forward' | 'rollback';
  readonly pointerBase64Url: string;
  readonly pointerPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly snapshotBase64Url: string;
  readonly snapshotPath: string;
}

interface PilotFixture {
  readonly bootstrapDefaults: Readonly<Record<string, unknown>>;
  readonly fixtureVersion: 1;
  readonly headers: string;
  readonly keys: Readonly<Record<string, string>>;
  readonly maximumSchemaVersion: number;
  readonly steps: readonly PilotFixtureStep[];
  readonly target: { brandId: string; channel: string; platform: string };
}

interface EmergencyFixture {
  readonly documents: Readonly<
    Record<
      'equivocation' | 'forcedMinimum' | 'killSwitch' | 'release',
      { readonly document: Readonly<Record<string, unknown>> }
    >
  >;
  readonly keys: { readonly emergency: Readonly<Record<string, string>> };
}

export const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/pilot-e2e-v1.json'), 'utf8'),
) as PilotFixture;
export const emergencyFixture = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      '../../../../packages/foundation/common/src/config/__fixtures__/emergency-handoff-v1.json',
    ),
    'utf8',
  ),
) as EmergencyFixture;

function fixtureStep(name: PilotFixtureStep['name']): PilotFixtureStep {
  const found = fixture.steps.find((step) => step.name === name);
  assert(found, `fixture step ${name} is missing`);
  return found;
}

export const baseline = fixtureStep('baseline');
export const canary = fixtureStep('canary-change');
export const rollback = fixtureStep('rollback');
export const rollForward = fixtureStep('roll-forward');

export function pointerBytes(step: PilotFixtureStep): Buffer {
  return Buffer.from(step.pointerBase64Url, 'base64url');
}
export function snapshotBytes(step: PilotFixtureStep): Buffer {
  return Buffer.from(step.snapshotBase64Url, 'base64url');
}
export function emergencyBytes(name: keyof EmergencyFixture['documents']): Buffer {
  return Buffer.from(JSON.stringify(emergencyFixture.documents[name].document), 'utf8');
}

// Same byte length keeps the JSON canonical while invalidating the Ed25519 signature.
export const tamperedPointer = Buffer.from(
  pointerBytes(canary).toString('utf8').replace('"pilot-revision-2"', '"pilot-revision-9"'),
  'utf8',
);
// Hash mismatch against the valid rollback pointer's sha256.
export const tamperedSnapshot = Buffer.from(
  snapshotBytes(baseline).toString('utf8').replace('Acme Studio', 'Acme StudiX'),
  'utf8',
);

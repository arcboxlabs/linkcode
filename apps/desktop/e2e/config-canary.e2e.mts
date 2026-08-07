// This E2E rebuilds desktop with MAIN_VITE_CONFIG_BOOTSTRAP; run it standalone rather than
// after a plain build.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import type { ElectronApplication } from 'playwright-core';
import type { DistServer, EmergencyServerMode, ServerMode } from './config-canary/dist-server.mts';
import {
  startDistServer,
  startEmergencyServer,
  waitForRequest,
} from './config-canary/dist-server.mts';
import {
  buildDesktopWithBootstrap,
  EMERGENCY_PORT,
  generateTlsMaterial,
  launchApp,
  PORT,
} from './config-canary/electron-app.mts';
import type { PilotFixtureStep } from './config-canary/fixture.mts';
import { baseline, canary, rollback, rollForward } from './config-canary/fixture.mts';
import type { ConfigStateFile } from './config-canary/state-file.mts';
import {
  readConfigState,
  readEmergencyState,
  waitForConfigState,
  writeCorruptConfigState,
} from './config-canary/state-file.mts';

const REJECTION_SETTLE_MS = 1000;

let mode: ServerMode = 'offline';
let emergencyMode: EmergencyServerMode = 'offline';

interface Harness {
  app: ElectronApplication | null;
  readonly caCert: string;
  readonly dist: DistServer;
  readonly emergency: DistServer;
  readonly home: string;
  readonly userData: string;
}

async function withLaunch(
  harness: Harness,
  nextMode: ServerMode,
  assertion: () => Promise<void>,
): Promise<void> {
  mode = nextMode;
  harness.dist.requests.length = 0;
  harness.app = await launchApp(harness.userData, harness.home, harness.caCert);
  try {
    await assertion();
  } finally {
    await harness.app.close().catch(noop);
    harness.app = null;
  }
}

function assertAccepted(state: ConfigStateFile, step: PilotFixtureStep): void {
  assert.deepEqual(state.value.lkg, {
    pointer: step.pointerBase64Url,
    snapshot: step.snapshotBase64Url,
  });
  assert.equal(state.value.highWater?.version, step.activationVersion);
  assert.equal(state.value.trusted?.pointer, step.pointerBase64Url);
}

async function driveScenarios(harness: Harness): Promise<void> {
  await withLaunch(harness, 'offline', async () => {
    await waitForRequest(
      harness.dist,
      (request) => request.path === baseline.pointerPath && request.status === 'disconnected',
    );
    assert.equal(await readConfigState(harness.home), null);
    console.log('PASS offline first launch renders without persisting remote state');
  });

  let baselineRaw = '';
  await withLaunch(harness, 'baseline', async () => {
    const state = await waitForConfigState(
      harness.home,
      ({ value }) => value.lkg?.pointer === baseline.pointerBase64Url,
    );
    assertAccepted(state, baseline);
    assert.equal(state.value.trusted?.etag, '"pilot-baseline"');
    baselineRaw = state.raw;
    console.log('PASS baseline fixture artifacts accepted and persisted verbatim');
  });

  await withLaunch(harness, 'baseline', async () => {
    const request = await waitForRequest(
      harness.dist,
      (candidate) => candidate.path === baseline.pointerPath && candidate.status === 304,
    );
    assert.equal(request.ifNoneMatch, '"pilot-baseline"');
    await wait(REJECTION_SETTLE_MS);
    assert.equal((await readConfigState(harness.home))?.raw, baselineRaw);
    console.log('PASS valid LKG restart revalidates the pointer via ETag');
  });

  let canaryRaw = '';
  await withLaunch(harness, 'canary-change', async () => {
    const state = await waitForConfigState(
      harness.home,
      ({ value }) => value.lkg?.pointer === canary.pointerBase64Url,
    );
    assertAccepted(state, canary);
    canaryRaw = state.raw;
    console.log('PASS structural canary fixture artifacts accepted');
  });

  await withLaunch(harness, 'tampered-pointer', async () => {
    await waitForRequest(
      harness.dist,
      (request) => request.path === canary.pointerPath && request.status === 200,
    );
    await wait(REJECTION_SETTLE_MS);
    assert.equal((await readConfigState(harness.home))?.raw, canaryRaw);
    console.log('PASS tampered pointer rejected without changing persisted state');
  });

  await withLaunch(harness, 'tampered-snapshot', async () => {
    await waitForRequest(
      harness.dist,
      (request) => request.path === rollback.snapshotPath && request.status === 200,
    );
    await waitForConfigState(
      harness.home,
      ({ value }) => value.trusted?.pointer === rollback.pointerBase64Url,
    );
    await wait(REJECTION_SETTLE_MS);
    const state = await readConfigState(harness.home);
    assert(state);
    assert.deepEqual(state.value.lkg, {
      pointer: canary.pointerBase64Url,
      snapshot: canary.snapshotBase64Url,
    });
    assert.equal(state.value.highWater?.version, rollback.activationVersion);
    console.log('PASS tampered snapshot rejected while retaining the canary LKG');
  });

  let rollbackRaw = '';
  await withLaunch(harness, 'rollback', async () => {
    const state = await waitForConfigState(
      harness.home,
      ({ value }) => value.lkg?.pointer === rollback.pointerBase64Url,
    );
    assertAccepted(state, rollback);
    assert.equal(rollback.sha256, baseline.sha256);
    rollbackRaw = state.raw;
    console.log('PASS rollback persists old content under a new activation version');
  });

  await withLaunch(harness, 'replay-canary', async () => {
    await waitForRequest(
      harness.dist,
      (request) => request.path === canary.pointerPath && request.status === 200,
    );
    await wait(REJECTION_SETTLE_MS);
    assert.equal((await readConfigState(harness.home))?.raw, rollbackRaw);
    console.log('PASS replayed pointer refused with rollback state unchanged');
  });

  let rollForwardRaw = '';
  await withLaunch(harness, 'roll-forward', async () => {
    const state = await waitForConfigState(
      harness.home,
      ({ value }) => value.lkg?.pointer === rollForward.pointerBase64Url,
    );
    assertAccepted(state, rollForward);
    rollForwardRaw = state.raw;
    console.log('PASS roll-forward accepted after rollback');
  });

  await withLaunch(harness, 'baseline', async () => {
    const request = await waitForRequest(
      harness.dist,
      (candidate) => candidate.path === baseline.pointerPath && candidate.status === 200,
    );
    assert.equal(request.ifNoneMatch, '"pilot-roll-forward"');
    await wait(REJECTION_SETTLE_MS);
    assert.equal((await readConfigState(harness.home))?.raw, rollForwardRaw);
    console.log('PASS replay protection survives restart');
  });

  await writeCorruptConfigState(harness.home);
  await withLaunch(harness, 'offline', async () => {
    await waitForConfigState(harness.home, ({ raw }) => raw === '{"version":1}');
    await waitForRequest(
      harness.dist,
      (request) => request.path === baseline.pointerPath && request.status === 'disconnected',
    );
    assert.equal((await readConfigState(harness.home))?.raw, '{"version":1}');
    console.log('PASS corrupt LKG discarded without preventing app startup');
  });

  await withLaunch(harness, 'baseline', async () => {
    const state = await waitForConfigState(
      harness.home,
      ({ value }) => value.lkg?.pointer === baseline.pointerBase64Url,
    );
    assertAccepted(state, baseline);
    console.log('PASS baseline republication recovers after corrupt-state reset');
  });

  emergencyMode = 'kill-switch';
  harness.emergency.requests.length = 0;
  await withLaunch(harness, 'offline', async () => {
    const app = assertApp(harness);
    const boundary = await refreshBoundary(app);
    assert.equal(boundary.report.normal, 'error');
    assert.equal(boundary.report.emergency, 'updated');
    const emergency = boundary.info.emergency;
    assert(emergency);
    assert.deepEqual(emergency.disabledFeatures, ['feature.aiAssist']);
    assert.equal(emergency.emergencyVersion, '1');
    await waitForRequest(
      harness.dist,
      (request) => request.path === baseline.pointerPath && request.status === 'disconnected',
    );
    await waitForRequest(
      harness.emergency,
      (request) => request.mode === 'kill-switch' && request.status === 200,
    );
    console.log('PASS emergency origin activates kill switch during main-channel outage');
  });

  emergencyMode = 'forced-minimum';
  harness.emergency.requests.length = 0;
  await withLaunch(harness, 'offline', async () => {
    const boundary = await refreshBoundary(assertApp(harness));
    assert.equal(boundary.report.emergency, 'updated');
    const emergency = boundary.info.emergency;
    assert(emergency);
    assert.equal(emergency.emergencyVersion, '2');
    assert.equal(emergency.forceMinVersion, '2.4.0');
    console.log('PASS newer emergency state replaces the persisted kill switch');
  });

  emergencyMode = 'offline';
  harness.emergency.requests.length = 0;
  await withLaunch(harness, 'offline', async () => {
    const boundary = await refreshBoundary(assertApp(harness));
    assert.equal(boundary.report.emergency, 'error');
    const emergency = boundary.info.emergency;
    assert(emergency);
    assert.equal(emergency.emergencyVersion, '2');
    assert.equal(emergency.forceMinVersion, '2.4.0');
    console.log('PASS forced minimum survives reconstructed runtime and emergency outage');
  });

  emergencyMode = 'release';
  harness.emergency.requests.length = 0;
  let releaseRaw = '';
  await withLaunch(harness, 'offline', async () => {
    const boundary = await refreshBoundary(assertApp(harness));
    assert.equal(boundary.report.emergency, 'updated');
    const emergency = boundary.info.emergency;
    assert(emergency);
    assert.deepEqual(emergency.disabledFeatures, []);
    assert.equal(emergency.emergencyVersion, '3');
    releaseRaw = (await readEmergencyState(harness.home))?.raw ?? '';
    assert(releaseRaw);
    console.log('PASS explicit newer release clears emergency restrictions');
  });

  emergencyMode = 'equivocation';
  harness.emergency.requests.length = 0;
  await withLaunch(harness, 'offline', async () => {
    const boundary = await refreshBoundary(assertApp(harness));
    assert.equal(boundary.report.emergency, 'error');
    const emergency = boundary.info.emergency;
    assert(emergency);
    assert.deepEqual(emergency.disabledFeatures, []);
    assert.equal(emergency.emergencyVersion, '3');
    assert.equal((await readEmergencyState(harness.home))?.raw, releaseRaw);
    console.log('PASS equal-version emergency equivocation cannot replace explicit release');
  });

  emergencyMode = 'offline';
  harness.emergency.requests.length = 0;
  await withLaunch(harness, 'offline', async () => {
    const boundary = await refreshBoundary(assertApp(harness));
    assert.equal(boundary.report.emergency, 'error');
    const emergency = boundary.info.emergency;
    assert(emergency);
    assert.deepEqual(emergency.disabledFeatures, []);
    assert.equal(emergency.emergencyVersion, '3');
    assert.equal((await readEmergencyState(harness.home))?.raw, releaseRaw);
    console.log('PASS explicit release remains sticky across reconstructed runtime and outage');
  });
}

function assertApp(harness: Harness): ElectronApplication {
  assert(harness.app);
  return harness.app;
}

async function refreshBoundary(app: ElectronApplication) {
  const page = await app.firstWindow();
  return page.evaluate(async () => {
    const report = await window.linkcodeConfig.refresh();
    return { info: window.linkcodeConfig.snapshotInfo(), report };
  });
}

async function main(): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'linkcode-config-canary-'));
  const userData = join(scratch, 'user-data');
  const home = join(scratch, 'home');
  let harness: Harness | null = null;
  try {
    const tls = generateTlsMaterial(scratch);
    buildDesktopWithBootstrap();
    const dist = await startDistServer(tls, PORT, () => mode);
    const emergency = await startEmergencyServer(tls, EMERGENCY_PORT, () => emergencyMode);
    harness = { app: null, caCert: tls.cert, dist, emergency, home, userData };
    await driveScenarios(harness);

    console.log(
      'PASS config canary/rollback E2E (publisher fixture → Pages-compatible origin → Electron)',
    );
  } finally {
    await harness?.app?.close().catch(noop);
    harness?.dist.server.close();
    harness?.emergency.server.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

void main();

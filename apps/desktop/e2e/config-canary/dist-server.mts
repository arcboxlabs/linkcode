import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:https';
import { createServer } from 'node:https';

import { waitFor } from 'foxts/wait-for';
import type { PilotFixtureStep } from './fixture.mts';
import {
  baseline,
  canary,
  emergencyBytes,
  fixture,
  pointerBytes,
  rollback,
  rollForward,
  snapshotBytes,
  tamperedPointer,
  tamperedSnapshot,
} from './fixture.mts';

export type ServerMode =
  | 'baseline'
  | 'canary-change'
  | 'offline'
  | 'replay-canary'
  | 'roll-forward'
  | 'rollback'
  | 'tampered-pointer'
  | 'tampered-snapshot';

export type EmergencyServerMode =
  | 'equivocation'
  | 'forced-minimum'
  | 'kill-switch'
  | 'offline'
  | 'release';

export interface DistRequest {
  readonly ifNoneMatch: string | null;
  readonly mode: EmergencyServerMode | ServerMode;
  readonly path: string;
  readonly status: 200 | 304 | 404 | 'disconnected';
}

export interface DistServer {
  readonly requests: DistRequest[];
  readonly server: Server;
}

interface PointerArtifact {
  readonly bytes: Buffer;
  readonly etag: string;
  readonly step: PilotFixtureStep;
}

const pointerArtifacts: Record<Exclude<ServerMode, 'offline'>, PointerArtifact> = {
  baseline: { bytes: pointerBytes(baseline), etag: '"pilot-baseline"', step: baseline },
  'canary-change': { bytes: pointerBytes(canary), etag: '"pilot-canary"', step: canary },
  'replay-canary': {
    bytes: pointerBytes(canary),
    etag: '"pilot-replay-canary"',
    step: canary,
  },
  rollback: { bytes: pointerBytes(rollback), etag: '"pilot-rollback"', step: rollback },
  'roll-forward': {
    bytes: pointerBytes(rollForward),
    etag: '"pilot-roll-forward"',
    step: rollForward,
  },
  'tampered-pointer': {
    bytes: tamperedPointer,
    etag: '"pilot-tampered-pointer"',
    step: canary,
  },
  'tampered-snapshot': {
    bytes: pointerBytes(rollback),
    etag: '"pilot-tampered-snapshot"',
    step: rollback,
  },
};

const snapshotArtifacts = new Map<string, Buffer>();
for (const step of fixture.steps) {
  const bytes = snapshotBytes(step);
  const existing = snapshotArtifacts.get(step.snapshotPath);
  assert(!existing || existing.equals(bytes), `conflicting fixture path ${step.snapshotPath}`);
  snapshotArtifacts.set(step.snapshotPath, bytes);
}

function pointerResponse(mode: ServerMode, path: string): PointerArtifact | null {
  if (mode === 'offline') return null;
  const artifact = pointerArtifacts[mode];
  return path === artifact.step.pointerPath ? artifact : null;
}

function snapshotResponse(mode: ServerMode, path: string): Buffer | null {
  if (mode === 'tampered-snapshot' && path === rollback.snapshotPath) return tamperedSnapshot;
  return snapshotArtifacts.get(path) ?? null;
}

export function startDistServer(
  tls: { cert: string; key: string },
  port: number,
  getMode: () => ServerMode,
): Promise<DistServer> {
  const requests: DistRequest[] = [];
  const server = createServer(
    { cert: readFileSync(tls.cert), key: readFileSync(tls.key) },
    (request, response) => {
      const mode = getMode();
      const path = new URL(request.url ?? '/', `https://127.0.0.1:${port}`).pathname;
      const header = request.headers['if-none-match'];
      const ifNoneMatch = typeof header === 'string' ? header : null;
      if (mode === 'offline') {
        requests.push({ ifNoneMatch, mode, path, status: 'disconnected' });
        request.socket.destroy();
        return;
      }
      const pointer = pointerResponse(mode, path);
      if (pointer) {
        if (request.headers['if-none-match'] === pointer.etag) {
          requests.push({ ifNoneMatch, mode, path, status: 304 });
          response.writeHead(304, { etag: pointer.etag }).end();
          return;
        }
        requests.push({ ifNoneMatch, mode, path, status: 200 });
        response
          .writeHead(200, {
            'cache-control': 'public, max-age=60, must-revalidate',
            'content-length': pointer.bytes.byteLength,
            'content-type': 'application/json',
            etag: pointer.etag,
          })
          .end(pointer.bytes);
        return;
      }
      const snapshot = snapshotResponse(mode, path);
      if (snapshot) {
        requests.push({ ifNoneMatch, mode, path, status: 200 });
        response
          .writeHead(200, {
            'cache-control': 'public, max-age=31536000, immutable',
            'content-length': snapshot.byteLength,
            'content-type': 'application/json',
          })
          .end(snapshot);
        return;
      }
      requests.push({ ifNoneMatch, mode, path, status: 404 });
      response.writeHead(404).end();
    },
  );
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ requests, server }));
  });
}

export function startEmergencyServer(
  tls: { cert: string; key: string },
  port: number,
  getMode: () => EmergencyServerMode,
): Promise<DistServer> {
  const requests: DistRequest[] = [];
  const server = createServer(
    { cert: readFileSync(tls.cert), key: readFileSync(tls.key) },
    (request, response) => {
      const mode = getMode();
      const path = new URL(request.url ?? '/', `https://127.0.0.1:${port}`).pathname;
      const header = request.headers['if-none-match'];
      const ifNoneMatch = typeof header === 'string' ? header : null;
      if (mode === 'offline') {
        requests.push({ ifNoneMatch, mode, path, status: 'disconnected' });
        request.socket.destroy();
        return;
      }
      if (path !== '/v1/acme/desktop/emergency.json') {
        requests.push({ ifNoneMatch, mode, path, status: 404 });
        response.writeHead(404).end();
        return;
      }
      const name =
        mode === 'kill-switch' ? 'killSwitch' : mode === 'forced-minimum' ? 'forcedMinimum' : mode;
      const bytes = emergencyBytes(name);
      const etag = `"emergency-${mode}"`;
      if (ifNoneMatch === etag) {
        requests.push({ ifNoneMatch, mode, path, status: 304 });
        response.writeHead(304, { etag }).end();
        return;
      }
      requests.push({ ifNoneMatch, mode, path, status: 200 });
      response
        .writeHead(200, {
          'cache-control': 'public, max-age=60, must-revalidate',
          'content-length': bytes.byteLength,
          'content-type': 'application/json',
          etag,
        })
        .end(bytes);
    },
  );
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ requests, server }));
  });
}

export function waitForRequest(
  server: DistServer,
  predicate: (request: DistRequest) => boolean,
): Promise<DistRequest> {
  return waitFor(() => server.requests.find(predicate) ?? false, 50, AbortSignal.timeout(30000));
}

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WireMessage, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Effect } from 'effect';
import { noop } from 'foxts/noop';
import { afterAll, describe, expect, it } from 'vitest';
import { ArtifactHostService } from '../preview/artifact-host-service';
import { ArtifactRequestHandler } from '../preview/request-handler';
import { PreviewRouteRegistry } from '../preview/route-registry';
import { ScriptRequestHandler } from '../scripts/request-handler';
import { ScriptService } from '../scripts/script-service';
import type { PtyBackend, PtyProcess } from '../terminal/pty-backend';
import { TerminalService } from '../terminal/service';
import { WireResponder } from '../wire/responder';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

class RejectingPtyBackend implements PtyBackend {
  open(): Promise<PtyProcess> {
    return Promise.reject(new Error('private spawn detail'));
  }

  shutdown(): void {
    /* no resources */
  }
}

function harness() {
  const sent: WirePayload[] = [];
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(message: WireMessage) {
      sent.push(message.payload);
    },
    onMessage: () => noop,
    onClose: () => noop,
    close: noop,
  };
  const responder = new WireResponder(transport);
  return { transport, responder, sent };
}

describe('Effect request handlers', () => {
  it('reports a script spawn failure without exposing its cause', async () => {
    const root = mkdtempSync(join(tmpdir(), 'linkcode-handler-test-'));
    roots.push(root);
    writeFileSync(
      join(root, 'linkcode.json'),
      JSON.stringify({ scripts: { build: { command: 'exit 1' } } }),
    );
    const { transport, responder, sent } = harness();
    const terminals = new TerminalService(new RejectingPtyBackend(), transport);
    const scripts = new ScriptService(transport, terminals, new PreviewRouteRegistry(), noop);
    scripts.bindRuntime(Effect.runFork);
    const handler = new ScriptRequestHandler(transport, scripts, responder);

    await Effect.runPromise(
      handler.handle({
        kind: 'script.start',
        clientReqId: 'script-1',
        cwd: root,
        scriptName: 'build',
      }),
    );

    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'script-1',
      code: 'operation_failed',
      message: 'Terminal failed to open',
    });
    expect(JSON.stringify(sent)).not.toContain('private spawn detail');
  });

  it('reports an unavailable preview listener without exposing its invariant', async () => {
    const { transport, responder, sent } = harness();
    const handler = new ArtifactRequestHandler(
      transport,
      new ArtifactHostService(new PreviewRouteRegistry()),
      responder,
    );

    await Effect.runPromise(
      handler.handle({
        kind: 'artifact.host',
        clientReqId: 'artifact-1',
        content: '<h1>private</h1>',
        mimeType: 'text/html',
      }),
    );

    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'artifact-1',
      code: 'operation_failed',
      message: 'Failed to host artifact',
    });
    expect(JSON.stringify(sent)).not.toContain('no bound listener');
  });
});

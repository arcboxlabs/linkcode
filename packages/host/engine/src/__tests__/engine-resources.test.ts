import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, SessionResource, WirePayload } from '@linkcode/schema';
import { MessageIdSchema, SessionIdSchema } from '@linkcode/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESOURCE_CONTEXT_SENTINEL } from '../resource/service';
import { createSessionHarness, startedSessionId } from './fixtures/session-harness';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'linkcode-resources-'));
  temporaryDirectories.push(path);
  return path;
}

function listedResources(sent: WirePayload[], replyTo: string): SessionResource[] {
  const reply = sent.find(
    (payload) => payload.kind === 'resource.listed' && payload.replyTo === replyTo,
  );
  if (reply?.kind !== 'resource.listed') throw new Error(`no resource.listed for ${replyTo}`);
  return reply.resources;
}

describe('engine session resources', () => {
  it('persists a source, injects only its path into the adapter prompt, and cleans it up', async () => {
    const stateDir = await tempDirectory();
    const h = createSessionHarness(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        stateDir,
      },
    );
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'start',
      opts: { kind: 'claude-code', cwd: stateDir },
    });
    const sessionId = startedSessionId(h.sent, 'start');

    await h.inject({
      kind: 'resource.source.upload',
      clientReqId: 'upload',
      sessionId,
      name: 'brief.txt',
      mimeType: 'text/plain',
      data: Buffer.from('source material').toString('base64'),
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'resource.uploaded', replyTo: 'upload' }),
      );
    });
    await h.inject({ kind: 'resource.list', clientReqId: 'list', sessionId });

    const [source] = listedResources(h.sent, 'list');
    expect(source).toMatchObject({
      direction: 'source',
      name: 'brief.txt',
      status: 'ready',
      locator: { type: 'managed-file' },
    });
    if (source.locator.type !== 'managed-file') throw new Error('expected managed source');
    expect(await readFile(source.locator.path, 'utf8')).toBe('source material');

    const mark = h.sent.length;
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'prompt',
      sessionId,
      input: { type: 'prompt', content: [{ type: 'text', text: 'Summarize this' }] },
    });
    expect(h.adapters[0].sentInputs.at(-1)).toEqual({
      type: 'prompt',
      content: [
        { type: 'text', text: 'Summarize this' },
        {
          type: 'text',
          text: `${RESOURCE_CONTEXT_SENTINEL}\n${source.locator.path}`,
        },
      ],
    });
    const echoes: AgentEvent[] = [];
    const sentSinceMark = h.sent.slice(mark);
    for (let i = 0, len = sentSinceMark.length; i < len; i++) {
      const payload = sentSinceMark[i];
      if (payload.kind === 'agent.event' && payload.event.type === 'user-message') {
        echoes.push(payload.event);
      }
    }
    expect(echoes).toMatchObject([{ content: [{ type: 'text', text: 'Summarize this' }] }]);

    await h.inject({
      kind: 'resource.remove',
      clientReqId: 'remove',
      resourceId: source.resourceId,
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'remove' });
    });
    await expect(stat(source.locator.path)).rejects.toMatchObject({ code: 'ENOENT' });

    await h.inject({
      kind: 'resource.source.upload',
      clientReqId: 'upload-for-delete',
      sessionId,
      name: 'delete-me.txt',
      data: Buffer.from('temporary').toString('base64'),
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'resource.uploaded', replyTo: 'upload-for-delete' }),
      );
    });
    const uploaded = h.sent.find(
      (payload) => payload.kind === 'resource.uploaded' && payload.replyTo === 'upload-for-delete',
    );
    if (uploaded?.kind !== 'resource.uploaded') throw new Error('missing uploaded resource');
    if (uploaded.resource.locator.type !== 'managed-file') throw new Error('expected managed file');
    await h.inject({ kind: 'session.delete', clientReqId: 'delete-session', sessionId });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'delete-session' });
    });
    await expect(stat(uploaded.resource.locator.path)).rejects.toMatchObject({ code: 'ENOENT' });

    const retained = join(stateDir, 'retained.txt');
    await writeFile(retained, 'safe');
    await h.inject({
      kind: 'session.delete',
      clientReqId: 'delete-invalid-session',
      sessionId: SessionIdSchema.parse('..'),
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual({
        kind: 'request.succeeded',
        replyTo: 'delete-invalid-session',
      });
    });
    expect(await readFile(retained, 'utf8')).toBe('safe');
    await h.engine.stop();
  });

  it('registers only persistent deliverables and stable resource links, without duplicates', async () => {
    const cwd = await tempDirectory();
    const h = createSessionHarness();
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'start',
      opts: { kind: 'claude-code', cwd },
    });
    const sessionId = startedSessionId(h.sent, 'start');
    await writeFile(join(cwd, 'report.pdf'), 'report');
    await writeFile(join(cwd, 'implementation.ts'), 'export {};');

    const completedTool: AgentEvent = {
      type: 'tool-call',
      toolCall: {
        toolCallId: 'write-output',
        title: 'Write outputs',
        kind: 'edit',
        status: 'completed',
        content: [
          { type: 'diff', change: 'add', path: 'report.pdf', newText: 'report' },
          { type: 'diff', change: 'add', path: 'implementation.ts', newText: 'export {};' },
          {
            type: 'content',
            content: {
              type: 'resource_link',
              uri: 'https://example.com/deliverables/site',
              name: 'Published site',
            },
          },
          {
            type: 'content',
            content: {
              type: 'resource_link',
              uri: 'ftp://example.com/ignored',
              name: 'Ignored link',
            },
          },
        ],
      },
    };
    h.adapters[0].emit(completedTool);
    h.adapters[0].emit(completedTool);
    await vi.waitFor(() => {
      expect(
        h.sent.filter(
          (payload) =>
            payload.kind === 'resource.changed' && payload.resource.direction === 'output',
        ),
      ).toHaveLength(2);
    });
    await h.inject({ kind: 'resource.list', clientReqId: 'list', sessionId });

    expect(listedResources(h.sent, 'list')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: 'output',
          name: 'report.pdf',
          kind: 'document',
          locator: { type: 'workspace-file', path: join(cwd, 'report.pdf') },
        }),
        expect.objectContaining({
          direction: 'output',
          name: 'Published site',
          kind: 'link',
          locator: { type: 'url', url: 'https://example.com/deliverables/site' },
        }),
      ]),
    );
    await h.engine.stop();
  });

  it('registers consumed web resources as sources and promotes presented results to outputs', async () => {
    const cwd = await tempDirectory();
    const h = createSessionHarness();
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'start',
      opts: { kind: 'claude-code', cwd },
    });
    const sessionId = startedSessionId(h.sent, 'start');
    const url = 'https://example.com/reference/call-for-papers';
    const fetched: AgentEvent = {
      type: 'tool-call',
      toolCall: {
        toolCallId: 'fetch-source',
        title: 'Fetch reference',
        kind: 'fetch',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: { type: 'resource_link', uri: url, name: 'Call for papers' },
          },
          {
            type: 'content',
            content: {
              type: 'resource_link',
              uri: `file://${join(cwd, 'local-reference.pdf')}`,
              name: 'Local reference',
            },
          },
        ],
      },
    };
    h.adapters[0].emit(fetched);
    h.adapters[0].emit(fetched);
    h.adapters[0].emit({
      ...fetched,
      toolCall: {
        ...fetched.toolCall,
        toolCallId: 'failed-fetch',
        status: 'failed',
        content: [
          {
            type: 'content',
            content: {
              type: 'resource_link',
              uri: 'https://example.com/unavailable',
              name: 'Unavailable',
            },
          },
        ],
      },
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({
          kind: 'resource.changed',
          resource: expect.objectContaining({ direction: 'source', name: 'Call for papers' }),
        }),
      );
    });
    await h.inject({ kind: 'resource.list', clientReqId: 'list-source', sessionId });
    expect(listedResources(h.sent, 'list-source')).toEqual([
      expect.objectContaining({
        direction: 'source',
        name: 'Call for papers',
        kind: 'link',
        locator: { type: 'url', url },
      }),
    ]);

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'follow-up',
      sessionId,
      input: { type: 'prompt', content: [{ type: 'text', text: 'Use the source again' }] },
    });
    expect(h.adapters[0].sentInputs.at(-1)).toEqual({
      type: 'prompt',
      content: [
        { type: 'text', text: 'Use the source again' },
        { type: 'text', text: `${RESOURCE_CONTEXT_SENTINEL}\n${url}` },
      ],
    });

    h.adapters[0].emit({
      type: 'agent-message',
      messageId: MessageIdSchema.parse('published-reference'),
      content: [{ type: 'resource_link', uri: url, name: 'Published reference' }],
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({
          kind: 'resource.changed',
          resource: expect.objectContaining({ direction: 'output', name: 'Published reference' }),
        }),
      );
    });
    await h.inject({ kind: 'resource.list', clientReqId: 'list-output', sessionId });
    expect(listedResources(h.sent, 'list-output')).toEqual([
      expect.objectContaining({
        direction: 'output',
        name: 'Published reference',
        locator: { type: 'url', url },
      }),
    ]);
    await h.engine.stop();
  });
});

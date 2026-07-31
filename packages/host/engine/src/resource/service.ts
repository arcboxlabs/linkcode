import { randomUUID } from 'node:crypto';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionId, SessionResource, SessionResourceId } from '@linkcode/schema';
import { MAX_ATTACHMENT_BYTES, SessionResourceIdSchema } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { noop } from 'foxts/noop';
import { OperationError, RequestError } from '../failure';
import type { FileHostService } from '../preview/file-host-service';
import type { SessionRecordRegistry } from '../session/session-record-registry';
import type { ResourceStore } from './resource-store';

export const RESOURCE_CONTEXT_SENTINEL = '[LinkCode session sources]';
const DELIVERABLE_EXTENSIONS = new Set([
  '.pdf',
  '.md',
  '.markdown',
  '.txt',
  '.doc',
  '.docx',
  '.rtf',
  '.odt',
  '.csv',
  '.tsv',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.key',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.html',
  '.htm',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const SITE_EXTENSIONS = new Set(['.html', '.htm']);
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.md', '.txt', '.doc', '.docx', '.rtf', '.odt']);
const rHttpUrl = /^https?:\/\//i;
const rUrlScheme = /^[a-z]+:/i;

export class ResourceService {
  constructor(
    private readonly transport: Transport,
    private readonly store: ResourceStore,
    private readonly records: SessionRecordRegistry,
    private readonly stateDir: string | undefined,
    private readonly fileHost: FileHostService,
  ) {}

  list(sessionId: SessionId): Effect.Effect<SessionResource[], OperationError> {
    return this.run('list', () => this.store.list(sessionId));
  }

  upload(
    sessionId: SessionId,
    name: string,
    mimeType: string | undefined,
    data: string,
  ): Effect.Effect<SessionResource, OperationError | RequestError> {
    const { records, stateDir, transport } = this;
    return Effect.gen({ self: this }, function* () {
      if (!records.has(sessionId)) {
        return yield* new RequestError({ code: 'not_found', message: 'Session not found' });
      }
      const bytes = Buffer.from(data, 'base64');
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        return yield* new RequestError({
          code: 'limit_exceeded',
          message: 'Resource exceeds the 8 MiB limit',
        });
      }
      const resourceId = SessionResourceIdSchema.parse(`resource-${randomUUID()}`);
      const directory = sessionResourceDirectory(stateDir, sessionId);
      if (!directory) {
        return yield* new RequestError({
          code: 'invalid_request',
          message: 'Session resource path is invalid',
        });
      }
      const path = resolve(directory, resourceId);
      const now = Date.now();
      let resource: SessionResource = {
        resourceId,
        sessionId,
        direction: 'source',
        name,
        kind: classify(name, mimeType),
        status: 'processing',
        locator: { type: 'managed-file', path },
        mimeType,
        sizeBytes: bytes.byteLength,
        createdAt: now,
        updatedAt: now,
      };
      yield* this.run('save', () => this.store.save(resource));
      transport.send(createWireMessage({ kind: 'resource.changed', resource }));
      const written = yield* Effect.tryPromise({
        async try() {
          await mkdir(resolve(path, '..'), { recursive: true });
          await writeFile(path, bytes);
        },
        catch: (cause) => cause,
      }).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
      resource = written
        ? { ...resource, status: 'ready', updatedAt: Date.now() }
        : {
            ...resource,
            status: 'failed',
            error: 'Failed to persist uploaded resource',
            updatedAt: Date.now(),
          };
      if (!written) yield* Effect.promise(() => rm(path, { force: true }).catch(noop));
      yield* this.run('save', () => this.store.save(resource));
      transport.send(createWireMessage({ kind: 'resource.changed', resource }));
      return resource;
    });
  }

  remove(resourceId: SessionResourceId): Effect.Effect<void, OperationError> {
    return this.run('remove', () => this.store.remove(resourceId)).pipe(
      Effect.flatMap((resource) =>
        Effect.promise(async () => {
          if (!resource) return;
          if (resource.direction === 'source' && resource.locator.type === 'managed-file') {
            await rm(resource.locator.path, { force: true });
          }
          this.transport.send(
            createWireMessage({
              kind: 'resource.removed',
              resourceId,
              sessionId: resource.sessionId,
            }),
          );
        }),
      ),
    );
  }

  host(
    resourceId: SessionResourceId,
  ): Effect.Effect<{ url: string }, OperationError | RequestError> {
    const { fileHost } = this;
    return Effect.gen({ self: this }, function* () {
      const resource = yield* this.run('get', () => this.store.get(resourceId));
      if (resource?.status !== 'ready') {
        return yield* new RequestError({
          code: 'not_found',
          message: 'Ready resource not found',
        });
      }
      if (resource.locator.type === 'url') return { url: resource.locator.url };
      const path = resource.locator.path;
      return yield* Effect.tryPromise({
        try: () => fileHost.hostAbsolute(path).then((hosted) => ({ url: hosted.url })),
        catch: (cause) =>
          new OperationError({
            subsystem: 'preview',
            operation: 'resource.host',
            publicMessage: 'Failed to host resource',
            cause,
          }),
      });
    });
  }

  readySourceLocators(sessionId: SessionId): Effect.Effect<string[], OperationError> {
    return this.list(sessionId).pipe(
      Effect.map((items) => {
        const locators: string[] = [];
        for (const resource of items) {
          if (resource.direction === 'source' && resource.status === 'ready') {
            locators.push(
              resource.locator.type === 'url' ? resource.locator.url : resource.locator.path,
            );
          }
        }
        return locators;
      }),
    );
  }

  registerSource(
    sessionId: SessionId,
    locator: string,
    name?: string,
    mimeType?: string,
  ): Effect.Effect<void, OperationError> {
    const record = this.records.get(sessionId);
    if (!record) return Effect.void;
    const normalized = normalizeResourceLocator(record.cwd, locator);
    if (normalized?.type !== 'url') return Effect.void;
    const now = Date.now();
    return this.persistDiscovered(
      {
        resourceId: SessionResourceIdSchema.parse(`resource-${randomUUID()}`),
        sessionId,
        direction: 'source',
        name: name ?? new URL(normalized.url).hostname,
        kind: 'link',
        status: 'ready',
        locator: normalized,
        mimeType,
        createdAt: now,
        updatedAt: now,
      },
      normalized.url,
    );
  }

  registerOutput(
    sessionId: SessionId,
    locator: string,
    name?: string,
    mimeType?: string,
  ): Effect.Effect<void, OperationError> {
    const { records } = this;
    return Effect.gen({ self: this }, function* () {
      const record = records.get(sessionId);
      if (!record) return;
      const normalized = normalizeResourceLocator(record.cwd, locator);
      if (!normalized) return;
      if (
        normalized.type === 'workspace-file' &&
        !DELIVERABLE_EXTENSIONS.has(extname(normalized.path).toLowerCase())
      ) {
        return;
      }
      const fileInfo =
        normalized.type === 'workspace-file'
          ? yield* Effect.tryPromise({
              try: () => stat(normalized.path),
              catch: (cause) => cause,
            }).pipe(
              Effect.map((info) => (info.isFile() ? info : undefined)),
              Effect.catch(() => Effect.succeed(undefined)),
            )
          : undefined;
      if (!fileInfo && normalized.type === 'workspace-file') return;
      const key = normalized.type === 'url' ? normalized.url : normalized.path;
      const outputName =
        normalized.type === 'url'
          ? basename(new URL(normalized.url).pathname) || new URL(normalized.url).hostname
          : basename(normalized.path);
      const now = Date.now();
      const resource: SessionResource = {
        resourceId: SessionResourceIdSchema.parse(`resource-${randomUUID()}`),
        sessionId,
        direction: 'output',
        name: name ?? outputName,
        kind: normalized.type === 'url' ? 'link' : classify(name ?? key, mimeType),
        status: 'ready',
        locator: normalized,
        mimeType,
        sizeBytes: fileInfo?.size,
        createdAt: now,
        updatedAt: now,
      };
      yield* this.persistDiscovered(resource, key);
    });
  }

  deleteSession(sessionId: SessionId): Effect.Effect<void, OperationError> {
    const directory = sessionResourceDirectory(this.stateDir, sessionId);
    return this.run('deleteSession', async () => {
      const removed = await this.store.deleteSession(sessionId);
      if (directory && removed.length > 0) {
        await rm(directory, { recursive: true, force: true }).catch(noop);
      } else if (directory) {
        void rm(directory, { recursive: true, force: true }).catch(noop);
      }
      return removed;
    }).pipe(
      Effect.tap((removed) =>
        Effect.sync(() => {
          for (const resource of removed) {
            this.transport.send(
              createWireMessage({
                kind: 'resource.removed',
                resourceId: resource.resourceId,
                sessionId,
              }),
            );
          }
        }),
      ),
      Effect.asVoid,
    );
  }

  private run<A>(operation: string, work: () => Promise<A>): Effect.Effect<A, OperationError> {
    return Effect.tryPromise({
      try: work,
      catch: (cause) =>
        new OperationError({
          subsystem: 'store',
          operation: `resources.${operation}`,
          publicMessage: 'Resource operation failed',
          cause,
        }),
    });
  }

  private persistDiscovered(
    resource: SessionResource,
    key: string,
  ): Effect.Effect<void, OperationError> {
    const { store, transport } = this;
    return Effect.gen({ self: this }, function* () {
      const existing = yield* this.run('findByLocator', () =>
        store.findByLocator(resource.sessionId, key),
      );
      if (existing && (resource.direction === 'source' || existing.direction === 'output')) return;
      const candidate = existing
        ? { ...resource, resourceId: existing.resourceId, createdAt: existing.createdAt }
        : resource;
      if (yield* this.run('save', () => store.save(candidate, key))) {
        transport.send(createWireMessage({ kind: 'resource.changed', resource: candidate }));
      }
    });
  }
}

function classify(name: string, mimeType?: string): SessionResource['kind'] {
  const ext = extname(name).toLowerCase();
  if (mimeType?.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (SITE_EXTENSIONS.has(ext)) return 'site';
  if (rHttpUrl.test(name)) return 'link';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  return 'file';
}

function normalizeResourceLocator(
  cwd: string,
  locator: string,
): SessionResource['locator'] | undefined {
  try {
    if (locator.startsWith('file://')) {
      return { type: 'workspace-file', path: resolve(fileURLToPath(locator)) };
    }
    if (rHttpUrl.test(locator)) {
      return { type: 'url', url: new URL(locator).href };
    }
    if (win32.isAbsolute(locator)) {
      return { type: 'workspace-file', path: resolve(locator) };
    }
    if (rUrlScheme.test(locator)) return undefined;
    return { type: 'workspace-file', path: resolve(cwd, locator) };
  } catch {
    return undefined;
  }
}

function sessionResourceDirectory(
  stateDir: string | undefined,
  sessionId: SessionId,
): string | undefined {
  const root = resolve(stateDir ?? join(tmpdir(), 'linkcode-engine'), 'resources');
  const directory = resolve(root, sessionId);
  return directory !== root && directory.startsWith(`${root}${sep}`) ? directory : undefined;
}

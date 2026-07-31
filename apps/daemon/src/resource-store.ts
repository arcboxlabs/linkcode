import type { ResourceStore } from '@linkcode/engine';
import type { SessionResource } from '@linkcode/schema';
import { SessionResourceSchema } from '@linkcode/schema';
import Sqlite from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sessionResources } from './db/schema';

export function createResourceStore(dbPath: string): ResourceStore {
  const sqlite = new Sqlite(dbPath);
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  return {
    list: (sessionId) =>
      Promise.resolve(
        db
          .select()
          .from(sessionResources)
          .where(eq(sessionResources.sessionId, sessionId))
          .all()
          .map(toResource),
      ),
    get: (resourceId) =>
      Promise.resolve(
        db.select().from(sessionResources).where(eq(sessionResources.resourceId, resourceId)).get(),
      ).then((row) => (row ? toResource(row) : undefined)),
    findByLocator: (sessionId, key) =>
      Promise.resolve(
        db
          .select()
          .from(sessionResources)
          .where(
            and(
              eq(sessionResources.sessionId, sessionId),
              eq(sessionResources.normalizedLocatorKey, key),
            ),
          )
          .get(),
      ).then((row) => (row ? toResource(row) : undefined)),
    save(resource, key) {
      const existing = key
        ? db
            .select({ id: sessionResources.resourceId })
            .from(sessionResources)
            .where(
              and(
                eq(sessionResources.sessionId, resource.sessionId),
                eq(sessionResources.normalizedLocatorKey, key),
              ),
            )
            .get()
        : undefined;
      if (existing && existing.id !== resource.resourceId) {
        return Promise.resolve(false);
      }
      const row = toRow(resource, key);
      const result = db
        .insert(sessionResources)
        .values(row)
        .onConflictDoUpdate({ target: sessionResources.resourceId, set: row })
        .run();
      return Promise.resolve(result.changes > 0);
    },
    remove(resourceId) {
      const row = db
        .select()
        .from(sessionResources)
        .where(eq(sessionResources.resourceId, resourceId))
        .get();
      if (row) db.delete(sessionResources).where(eq(sessionResources.resourceId, resourceId)).run();
      return Promise.resolve(row ? toResource(row) : undefined);
    },
    deleteSession(sessionId) {
      const rows = db
        .select()
        .from(sessionResources)
        .where(eq(sessionResources.sessionId, sessionId))
        .all();
      db.delete(sessionResources).where(eq(sessionResources.sessionId, sessionId)).run();
      return Promise.resolve(rows.map(toResource));
    },
  };
}
type Row = typeof sessionResources.$inferSelect;
function toResource(row: Row): SessionResource {
  return SessionResourceSchema.parse({
    resourceId: row.resourceId,
    sessionId: row.sessionId,
    direction: row.direction,
    name: row.name,
    kind: row.kind,
    status: row.status,
    locator:
      row.locatorType === 'url'
        ? { type: 'url', url: row.locator }
        : { type: row.locatorType, path: row.locator },
    mimeType: row.mimeType ?? undefined,
    sizeBytes: row.sizeBytes ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
function toRow(resource: SessionResource, key?: string): typeof sessionResources.$inferInsert {
  return {
    resourceId: resource.resourceId,
    sessionId: resource.sessionId,
    direction: resource.direction,
    name: resource.name,
    kind: resource.kind,
    status: resource.status,
    locatorType: resource.locator.type,
    locator: resource.locator.type === 'url' ? resource.locator.url : resource.locator.path,
    normalizedLocatorKey: key ?? null,
    mimeType: resource.mimeType ?? null,
    sizeBytes: resource.sizeBytes ?? null,
    error: resource.error ?? null,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

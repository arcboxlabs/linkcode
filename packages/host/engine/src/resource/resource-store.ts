import type { SessionId, SessionResource, SessionResourceId } from '@linkcode/schema';

export interface ResourceStore {
  list(sessionId: SessionId): Promise<SessionResource[]>;
  get(resourceId: SessionResourceId): Promise<SessionResource | undefined>;
  save(resource: SessionResource, normalizedLocatorKey?: string): Promise<boolean>;
  remove(resourceId: SessionResourceId): Promise<SessionResource | undefined>;
  deleteSession(sessionId: SessionId): Promise<SessionResource[]>;
}

export class InMemoryResourceStore implements ResourceStore {
  private readonly resources = new Map<SessionResourceId, SessionResource>();
  private readonly locatorKeys = new Map<string, SessionResourceId>();

  list(sessionId: SessionId): Promise<SessionResource[]> {
    const resources: SessionResource[] = [];
    for (const resource of this.resources.values()) {
      if (resource.sessionId === sessionId) resources.push(structuredClone(resource));
    }
    return Promise.resolve(resources);
  }

  get(resourceId: SessionResourceId): Promise<SessionResource | undefined> {
    const value = this.resources.get(resourceId);
    return Promise.resolve(value ? structuredClone(value) : undefined);
  }

  save(resource: SessionResource, normalizedLocatorKey?: string): Promise<boolean> {
    if (normalizedLocatorKey) {
      const key = `${resource.sessionId}:${normalizedLocatorKey}`;
      if (this.locatorKeys.has(key)) return Promise.resolve(false);
      this.locatorKeys.set(key, resource.resourceId);
    }
    this.resources.set(resource.resourceId, structuredClone(resource));
    return Promise.resolve(true);
  }

  remove(resourceId: SessionResourceId): Promise<SessionResource | undefined> {
    const value = this.resources.get(resourceId);
    if (!value) return Promise.resolve(undefined);
    this.resources.delete(resourceId);
    for (const [key, id] of this.locatorKeys) if (id === resourceId) this.locatorKeys.delete(key);
    return Promise.resolve(structuredClone(value));
  }

  async deleteSession(sessionId: SessionId): Promise<SessionResource[]> {
    const values = await this.list(sessionId);
    const removals: Array<Promise<SessionResource | undefined>> = [];
    for (const value of values) removals.push(this.remove(value.resourceId));
    await Promise.all(removals);
    return values;
  }
}

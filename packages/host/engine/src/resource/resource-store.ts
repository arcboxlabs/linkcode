import type { SessionId, SessionResource, SessionResourceId } from '@linkcode/schema';

export interface ResourceStore {
  list(sessionId: SessionId): Promise<SessionResource[]>;
  get(resourceId: SessionResourceId): Promise<SessionResource | undefined>;
  findByLocator(
    sessionId: SessionId,
    normalizedLocatorKey: string,
  ): Promise<SessionResource | undefined>;
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

  findByLocator(
    sessionId: SessionId,
    normalizedLocatorKey: string,
  ): Promise<SessionResource | undefined> {
    const resourceId = this.locatorKeys.get(`${sessionId}:${normalizedLocatorKey}`);
    return resourceId ? this.get(resourceId) : Promise.resolve(undefined);
  }

  save(resource: SessionResource, normalizedLocatorKey?: string): Promise<boolean> {
    if (normalizedLocatorKey) {
      const key = `${resource.sessionId}:${normalizedLocatorKey}`;
      const existingId = this.locatorKeys.get(key);
      if (existingId && existingId !== resource.resourceId) return Promise.resolve(false);
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
    for (let i = 0, len = values.length; i < len; i++) {
      const value = values[i];
      removals.push(this.remove(value.resourceId));
    }
    await Promise.all(removals);
    return values;
  }
}

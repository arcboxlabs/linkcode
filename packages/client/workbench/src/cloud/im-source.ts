import { z } from 'zod';
import type {
  CloudImBinding,
  CloudImBindingCreate,
  CloudImBindResult,
  CloudImLinkResult,
  CloudImOverview,
  CloudImPreferences,
  CloudImSource,
} from './im';

/**
 * Browser-side CloudImSource whose credential is the ambient session cookie. Desktop does NOT use
 * this — its keychain session lives in the Electron main process behind the preload bridge.
 */

const overviewSchema = z.object({
  accounts: z.array(
    z.object({
      platform: z.literal('telegram'),
      accountId: z.string(),
      linkedAt: z.string(),
    }),
  ),
  chats: z.array(
    z.object({
      chatId: z.string(),
      title: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  bot: z.object({ username: z.string() }).nullable(),
});

const bindingsSchema = z.object({
  bindings: z.array(
    z.object({
      sessionId: z.string(),
      platform: z.literal('telegram'),
      chatId: z.string(),
      topicId: z.string(),
      state: z.enum(['live', 'muted']),
      pushOut: z.boolean(),
      acceptIn: z.boolean(),
      createdFrom: z.enum(['im', 'client']),
      lastDeliveredSeq: z.number(),
      updatedAt: z.number(),
    }),
  ),
});

const preferencesSchema = z.object({
  autoMirror: z.boolean(),
  chatId: z.string().nullable(),
});

const bindResultSchema = z.object({
  ok: z.literal(true),
  chatId: z.string(),
  topicId: z.string().nullable(),
});

export function createBrowserCloudImSource(apiUrl: string): CloudImSource {
  const call = (path: string, init?: RequestInit): Promise<Response> =>
    fetch(`${apiUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...init?.headers },
    });

  return {
    async overview(): Promise<CloudImOverview> {
      const res = await call('/im/accounts');
      if (!res.ok) throw new Error(`im overview: ${res.status}`);
      return overviewSchema.parse(await res.json());
    },
    async bindings(): Promise<CloudImBinding[]> {
      const res = await call('/im/bindings');
      if (!res.ok) throw new Error(`im bindings: ${res.status}`);
      return bindingsSchema.parse(await res.json()).bindings;
    },
    async linkTelegram(code: string): Promise<CloudImLinkResult> {
      const res = await call('/im/link/telegram', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      if (res.ok) return { ok: true };
      if (res.status === 404 || res.status === 400) return { ok: false, reason: 'not-found' };
      if (res.status === 409) return { ok: false, reason: 'conflict' };
      throw new Error(`link telegram: ${res.status}`);
    },
    async unlinkTelegram(): Promise<void> {
      const res = await call('/im/accounts/telegram', { method: 'DELETE' });
      if (!res.ok) throw new Error(`unlink telegram: ${res.status}`);
    },
    async createBinding(input: CloudImBindingCreate): Promise<CloudImBindResult> {
      const res = await call('/im/bindings', { method: 'POST', body: JSON.stringify(input) });
      if (res.status === 409) return { ok: false, reason: 'exists' };
      if (!res.ok) throw new Error(`create binding: ${res.status}`);
      return bindResultSchema.parse(await res.json());
    },
    async updateBinding(sessionId: string, patch: { pushOut: boolean }): Promise<void> {
      const res = await call(`/im/bindings/${encodeURIComponent(sessionId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`update binding: ${res.status}`);
    },
    async deleteBinding(sessionId: string): Promise<void> {
      const res = await call(`/im/bindings/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`delete binding: ${res.status}`);
    },
    async preferences(): Promise<CloudImPreferences> {
      const res = await call('/im/preferences/telegram');
      if (!res.ok) throw new Error(`im preferences: ${res.status}`);
      return preferencesSchema.parse(await res.json());
    },
    async setPreferences(pref: CloudImPreferences): Promise<void> {
      const res = await call('/im/preferences/telegram', {
        method: 'PUT',
        body: JSON.stringify(pref),
      });
      if (!res.ok) throw new Error(`set preferences: ${res.status}`);
    },
  };
}

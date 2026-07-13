import type {
  CloudImBinding,
  CloudImBindResult,
  CloudImLinkResult,
  CloudImOverview,
  CloudImPreferences,
} from '@linkcode/workbench';
import { ipcMain } from 'electron';
import { z } from 'zod';
import {
  CLOUD_IM_BINDINGS_CHANNEL,
  CLOUD_IM_CREATE_BINDING_CHANNEL,
  CLOUD_IM_DELETE_BINDING_CHANNEL,
  CLOUD_IM_GET_PREFERENCES_CHANNEL,
  CLOUD_IM_LINK_TELEGRAM_CHANNEL,
  CLOUD_IM_OVERVIEW_CHANNEL,
  CLOUD_IM_SET_PREFERENCES_CHANNEL,
  CLOUD_IM_UNLINK_TELEGRAM_CHANNEL,
  CLOUD_IM_UPDATE_BINDING_CHANNEL,
} from '../../shared/cloud';
import { authClient, CLOUD_API_URL } from './client';

/**
 * IM Channel management against the cloud API (`/im/*`). Same shape as tunnel.ts: the keychain
 * session lives in main, so main attaches it and hands the renderer only validated data.
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

const preferencesSchema = z.object({
  autoMirror: z.boolean(),
  chatId: z.string().nullable(),
});

const bindingCreateSchema = z.object({
  sessionId: z.string().min(1),
  chatId: z.string().min(1),
  title: z.string().optional(),
  kind: z.string().optional(),
  historyId: z.string().optional(),
});

const bindResultSchema = z.object({
  ok: z.literal(true),
  chatId: z.string(),
  topicId: z.string().nullable(),
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

function cloudFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${CLOUD_API_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, cookie: authClient.getCookie() },
  });
}

async function getImOverview(): Promise<CloudImOverview> {
  const res = await cloudFetch('/im/accounts');
  if (!res.ok) throw new Error(`getImOverview: ${res.status} ${res.statusText}`);
  return overviewSchema.parse(await res.json());
}

async function getImBindings(): Promise<CloudImBinding[]> {
  const res = await cloudFetch('/im/bindings');
  if (!res.ok) throw new Error(`getImBindings: ${res.status} ${res.statusText}`);
  return bindingsSchema.parse(await res.json()).bindings;
}

/**
 * Confirms a `/link` code. Expected rejections map to data — 404 is a wrong/expired code, 409 a
 * Telegram identity already linked to another user — because they cross the IPC boundary, where
 * thrown errors lose their shape.
 */
async function linkTelegram(code: string): Promise<CloudImLinkResult> {
  const res = await cloudFetch('/im/link/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (res.ok) return { ok: true };
  if (res.status === 404 || res.status === 400) return { ok: false, reason: 'not-found' };
  if (res.status === 409) return { ok: false, reason: 'conflict' };
  throw new Error(`linkTelegram: ${res.status} ${res.statusText}`);
}

async function unlinkTelegram(): Promise<void> {
  const res = await cloudFetch('/im/accounts/telegram', { method: 'DELETE' });
  if (!res.ok) throw new Error(`unlinkTelegram: ${res.status} ${res.statusText}`);
}

/** 409 (already bound) is an expected outcome, mapped to data across the IPC boundary. */
async function createBinding(
  input: z.infer<typeof bindingCreateSchema>,
): Promise<CloudImBindResult> {
  const res = await cloudFetch('/im/bindings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 409) return { ok: false, reason: 'exists' };
  if (!res.ok) throw new Error(`createBinding: ${res.status} ${res.statusText}`);
  return bindResultSchema.parse(await res.json());
}

async function updateBinding(sessionId: string, patch: { pushOut: boolean }): Promise<void> {
  const res = await cloudFetch(`/im/bindings/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updateBinding: ${res.status} ${res.statusText}`);
}

async function deleteBinding(sessionId: string): Promise<void> {
  const res = await cloudFetch(`/im/bindings/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`deleteBinding: ${res.status} ${res.statusText}`);
}

async function getPreferences(): Promise<CloudImPreferences> {
  const res = await cloudFetch('/im/preferences/telegram');
  if (!res.ok) throw new Error(`getPreferences: ${res.status} ${res.statusText}`);
  return preferencesSchema.parse(await res.json());
}

async function setPreferences(pref: CloudImPreferences): Promise<void> {
  const res = await cloudFetch('/im/preferences/telegram', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pref),
  });
  if (!res.ok) throw new Error(`setPreferences: ${res.status} ${res.statusText}`);
}

/** Registers the IM-channel IPC the preload's `linkcodeCloud.im` bridge invokes. */
export function registerCloudImBridge(): void {
  ipcMain.handle(CLOUD_IM_OVERVIEW_CHANNEL, () => getImOverview());
  ipcMain.handle(CLOUD_IM_BINDINGS_CHANNEL, () => getImBindings());
  ipcMain.handle(CLOUD_IM_LINK_TELEGRAM_CHANNEL, (_event, code: unknown) =>
    linkTelegram(z.string().min(4).max(16).parse(code)),
  );
  ipcMain.handle(CLOUD_IM_UNLINK_TELEGRAM_CHANNEL, () => unlinkTelegram());
  ipcMain.handle(CLOUD_IM_CREATE_BINDING_CHANNEL, (_event, input: unknown) =>
    createBinding(bindingCreateSchema.parse(input)),
  );
  ipcMain.handle(CLOUD_IM_UPDATE_BINDING_CHANNEL, (_event, sessionId: unknown, patch: unknown) =>
    updateBinding(
      z.string().min(1).parse(sessionId),
      z.object({ pushOut: z.boolean() }).parse(patch),
    ),
  );
  ipcMain.handle(CLOUD_IM_DELETE_BINDING_CHANNEL, (_event, sessionId: unknown) =>
    deleteBinding(z.string().min(1).parse(sessionId)),
  );
  ipcMain.handle(CLOUD_IM_GET_PREFERENCES_CHANNEL, () => getPreferences());
  ipcMain.handle(CLOUD_IM_SET_PREFERENCES_CHANNEL, (_event, pref: unknown) =>
    setPreferences(preferencesSchema.parse(pref)),
  );
}

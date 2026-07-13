import { z } from 'zod';
import { SessionIdSchema, TimestampSchema } from './common';

/**
 * IM Channel contract: bridging agent sessions (UI "Threads") to messaging platforms.
 * Product name "IM Channel"; a single platform integration is a "bridge" (`TelegramBridge`).
 *
 * Deliberately NOT part of the wire union: the cloud router owns bindings and routing, and it
 * speaks the existing wire operations to the daemon as an ordinary client. The daemon's wire
 * protocol stays IM-agnostic; these types are the shared vocabulary between the cloud router,
 * the bridges, and the management UI.
 */

export const ImPlatformSchema = z.enum(['telegram']);
export type ImPlatform = z.infer<typeof ImPlatformSchema>;

/** The human's identity on the platform side (e.g. a Telegram user). Ids are stringified. */
export const ImExternalIdentitySchema = z.object({
  platform: ImPlatformSchema,
  userId: z.string().min(1),
  username: z.string().optional(),
  displayName: z.string().optional(),
});
export type ImExternalIdentity = z.infer<typeof ImExternalIdentitySchema>;

/** A routable message target: a chat, optionally narrowed to a thread/topic inside it. */
export const ImChannelRefSchema = z.object({
  platform: ImPlatformSchema,
  /** Platform chat id (e.g. the Telegram forum supergroup id), stringified. */
  chatId: z.string().min(1),
  /** Thread/topic id inside the chat (e.g. Telegram `message_thread_id`), where the platform has one. */
  topicId: z.string().min(1).optional(),
});
export type ImChannelRef = z.infer<typeof ImChannelRefSchema>;

/** Binding lifecycle: `live` pushes agent events out; `muted` is paused (topic kept, nothing pushed). */
export const ImBindingStateSchema = z.enum(['live', 'muted']);
export type ImBindingState = z.infer<typeof ImBindingStateSchema>;

/** Which side created a binding: accepted/created from the IM, or exported from a LinkCode client. */
export const ImBindingOriginSchema = z.enum(['im', 'client']);
export type ImBindingOrigin = z.infer<typeof ImBindingOriginSchema>;

/**
 * A topic ↔ session binding — the first-class object the cloud router owns and persists.
 * Topic existence equals subscription: creating the topic creates the binding, `muted` pauses
 * push without unbinding, and only an explicit unlink removes it.
 *
 * v1 semantics: `state === 'muted'` mirrors `pushOut === false` (pausing only flips push-out);
 * `acceptIn` stays true for the binding's lifetime and is not yet surfaced in any UI.
 */
export const ImBindingSchema = z.object({
  sessionId: SessionIdSchema,
  platform: ImPlatformSchema,
  chatId: z.string().min(1),
  topicId: z.string().min(1),
  state: ImBindingStateSchema,
  /** Push agent events out to the platform. */
  pushOut: z.boolean(),
  /** Accept platform messages as prompts. Permission replies bypass this (they answer an agent ask). */
  acceptIn: z.boolean(),
  createdFrom: ImBindingOriginSchema,
  /**
   * The last event sequence number delivered to the platform, in the router's per-session receive
   * order (the same monotone counting as `client-core`'s receive seq). `currentSeq > lastDeliveredSeq`
   * on a muted binding is what arms the stale guard ("N unseen updates").
   */
  lastDeliveredSeq: z.number().int().nonnegative(),
  updatedAt: TimestampSchema,
});
export type ImBinding = z.infer<typeof ImBindingSchema>;

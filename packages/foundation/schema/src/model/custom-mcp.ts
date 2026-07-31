import { z } from 'zod';
import { McpServerSchema } from './agent';
import { TimestampSchema } from './primitives';

/**
 * A LinkCode-owned ("bring your own") MCP server, independent of any provider plugin. It is
 * persisted in the daemon config and injected into MCP-capable sessions' StartOptions at start —
 * never written into a provider's own config file (codex has its own `codex mcp` store).
 */
export const CustomMcpServerSchema = z.object({
  /** Client-minted, stable across edits (mirrors the Account.id precedent). */
  id: z.string().min(1),
  enabled: z.boolean(),
  server: McpServerSchema,
  createdAt: TimestampSchema,
});
export type CustomMcpServer = z.infer<typeof CustomMcpServerSchema>;

/**
 * Masked read projection: env/header values may hold secrets, so only their keys leave the
 * daemon. A client can show "3 env vars configured" but can never echo a value back.
 */
export const McpServerPublicSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stdio'),
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    envKeys: z.array(z.string()),
  }),
  z.object({
    type: z.literal('http'),
    name: z.string(),
    url: z.string(),
    headerKeys: z.array(z.string()),
  }),
]);
export type McpServerPublic = z.infer<typeof McpServerPublicSchema>;

export const CustomMcpServerPublicSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  server: McpServerPublicSchema,
  createdAt: TimestampSchema,
});
export type CustomMcpServerPublic = z.infer<typeof CustomMcpServerPublicSchema>;

/** Per-key secret edit: values in `set` are written, keys in `remove` are deleted, every other
 * stored key is preserved. This is what makes "leave blank to keep" sound when the client only
 * ever holds the masked projection. Strict, so a plain `{KEY: value}` map is rejected loudly
 * instead of stripping to an empty patch and silently dropping the caller's values. */
export const McpSecretPatchSchema = z.strictObject({
  set: z.record(z.string().min(1), z.string()).optional(),
  remove: z.array(z.string().min(1)).optional(),
});
export type McpSecretPatch = z.infer<typeof McpSecretPatchSchema>;

/**
 * Update payload for one stored server. Non-secret fields replace wholesale; secrets patch
 * per key. The transport `type` must match the stored server — switching transport is expressed
 * as `remove` + `add`, which naturally forces secret re-entry.
 */
export const McpServerUpdateSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stdio'),
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: McpSecretPatchSchema.optional(),
  }),
  z.object({
    type: z.literal('http'),
    name: z.string(),
    url: z.string(),
    headers: McpSecretPatchSchema.optional(),
  }),
]);
export type McpServerUpdate = z.infer<typeof McpServerUpdateSchema>;

/** Patch-op writes (config.set). A full-array replace is deliberately impossible: the client
 * only sees the masked projection, so resending whole servers would clobber stored secrets. */
export const CustomMcpServerPatchOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), server: CustomMcpServerSchema }),
  z.object({
    op: z.literal('update'),
    id: z.string().min(1),
    enabled: z.boolean().optional(),
    server: McpServerUpdateSchema.optional(),
  }),
  z.object({ op: z.literal('remove'), id: z.string().min(1) }),
]);
export type CustomMcpServerPatchOp = z.infer<typeof CustomMcpServerPatchOpSchema>;

/** Session-start advisory about custom MCP injection, carried on `session.started`. */
export const McpWarningReasonSchema = z.enum([
  'agent-unsupported',
  'name-conflict',
  'provider-unsupported',
  'provider-preflight-failed',
]);
export type McpWarningReason = z.infer<typeof McpWarningReasonSchema>;

export const McpWarningSchema = z.object({
  serverName: z.string().min(1),
  reason: McpWarningReasonSchema,
});
export type McpWarning = z.infer<typeof McpWarningSchema>;

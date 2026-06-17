import { z } from 'zod';

/**
 * Content blocks — mirrors the Agent Client Protocol (ACP) ContentBlock union (which ACP shares with MCP).
 * The discriminator is `type`; values stay in ACP/MCP snake_case form (`resource_link`) so the generic
 * ACP adapter maps 1:1. See https://agentclientprotocol.com/protocol/content.
 */

/** Optional MCP-style annotations attached to a content block. */
export const AnnotationsSchema = z.object({
  audience: z.array(z.enum(['user', 'assistant'])).optional(),
  priority: z.number().optional(),
  lastModified: z.string().optional(),
});
export type Annotations = z.infer<typeof AnnotationsSchema>;

/** Embedded resource contents: either inline text or a base64 blob. */
export const EmbeddedResourceResourceSchema = z.union([
  z.object({ uri: z.string(), text: z.string(), mimeType: z.string().optional() }),
  z.object({ uri: z.string(), blob: z.string(), mimeType: z.string().optional() }),
]);
export type EmbeddedResourceResource = z.infer<typeof EmbeddedResourceResourceSchema>;

export const ContentBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
    annotations: AnnotationsSchema.optional(),
  }),
  z.object({
    type: z.literal('image'),
    data: z.string(), // base64
    mimeType: z.string(),
    uri: z.string().optional(),
    annotations: AnnotationsSchema.optional(),
  }),
  z.object({
    type: z.literal('audio'),
    data: z.string(), // base64
    mimeType: z.string(),
    annotations: AnnotationsSchema.optional(),
  }),
  z.object({
    type: z.literal('resource_link'),
    uri: z.string(),
    name: z.string(),
    mimeType: z.string().optional(),
    size: z.number().int().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    annotations: AnnotationsSchema.optional(),
  }),
  z.object({
    type: z.literal('resource'),
    resource: EmbeddedResourceResourceSchema,
    annotations: AnnotationsSchema.optional(),
  }),
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

/** Convenience builder for the most common case, a plain text block. */
export function textBlock(text: string): ContentBlock {
  return { type: 'text', text };
}

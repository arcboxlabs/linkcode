import { z } from 'zod';

/** Content blocks shared by all four supported agents. The discriminator is `type`; values stay
 * in MCP snake_case form (`resource_link`) so MCP results map across with no renaming. */

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

/** Exact base64 length of `bytes` raw bytes: 4 chars per 3-byte group, final group padded. */
function base64Length(bytes: number): number {
  return 4 * Math.ceil(bytes / 3);
}

/** Image types every image-capable adapter accepts (Claude's enum is the narrowest set). The
 * composer offers only these and the engine rejects the rest, so adapters skip re-validation. */
export const SUPPORTED_ATTACHMENT_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;
export type SupportedAttachmentImageMimeType =
  (typeof SUPPORTED_ATTACHMENT_IMAGE_MIME_TYPES)[number];

export function isSupportedAttachmentImageMimeType(
  mimeType: string,
): mimeType is SupportedAttachmentImageMimeType {
  return (SUPPORTED_ATTACHMENT_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** Hard cap on one image/audio/resource block's raw payload — base64-inflated it crosses the
 * JSON wire and is held in daemon memory before being forwarded to the adapter. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** Aggregate raw-byte cap across every attachment block carried by one prompt. */
export const MAX_ATTACHMENT_TOTAL_BYTES = 12 * 1024 * 1024;

/** `MAX_ATTACHMENT_TOTAL_BYTES` in wire units: what a maximal prompt's attachments occupy as
 * base64. Transports must size their frame buffers above this plus envelope headroom. */
export const MAX_ATTACHMENT_TOTAL_BASE64_LENGTH = base64Length(MAX_ATTACHMENT_TOTAL_BYTES);

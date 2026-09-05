import type { AgentCapabilities, AgentKind, AttachmentCapability } from '@linkcode/schema';
import { effectiveAttachmentCapability, intersectAttachmentCapability } from '@linkcode/schema';

/**
 * Host ∩ the harness declaration. `capabilities-update` carries the raw adapter object, so a
 * live session must intersect it when the field is present. An omitted `attachments` field is the
 * old-daemon shape (and grok-build) — fall back to the pre-session matrix so inline images stay
 * available until the floor bump.
 */
export function composerAttachmentCapability(
  kind: AgentKind | undefined,
  live?: AgentCapabilities | null,
): AttachmentCapability | undefined {
  if (kind === undefined) return undefined;
  if (live?.attachments === undefined) return effectiveAttachmentCapability(kind);
  return intersectAttachmentCapability(live.attachments);
}

export function composerAttachmentsSupported(
  kind: AgentKind | undefined,
  live?: AgentCapabilities | null,
): boolean {
  return composerAttachmentCapability(kind, live)?.kinds.image !== undefined;
}

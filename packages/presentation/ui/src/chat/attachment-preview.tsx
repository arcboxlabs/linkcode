import { createContext, useContext, useSyncExternalStore } from 'react';

export interface AttachmentPreview {
  url?: string;
  mimeType?: string;
}

export type AttachmentPreviewResolve = (attachmentId: string) => Promise<AttachmentPreview | null>;

const AttachmentPreviewContext = createContext<AttachmentPreviewResolve | null>(null);

const previews = new Map<string, AttachmentPreview>();
const inflight = new Set<string>();
const failedUntil = new Map<string, number>();
const retryTimers = new Set<ReturnType<typeof setTimeout>>();
let previewVersion = 0;
let previewGeneration = 0;
const previewListeners = new Set<() => void>();
const PREVIEW_RETRY_MS = 2000;

function subscribePreviews(onStoreChange: () => void): () => void {
  previewListeners.add(onStoreChange);
  return () => {
    previewListeners.delete(onStoreChange);
  };
}

function previewStoreVersion(): number {
  return previewVersion;
}

function bumpPreviews(): void {
  previewVersion += 1;
  for (const listener of previewListeners) listener();
}

function ensurePreview(attachmentId: string, resolve: AttachmentPreviewResolve): void {
  if (previews.has(attachmentId) || inflight.has(attachmentId)) return;
  const retryAt = failedUntil.get(attachmentId);
  if (retryAt !== undefined && retryAt > Date.now()) return;
  inflight.add(attachmentId);
  const generation = previewGeneration;
  void resolve(attachmentId)
    .then((result) => {
      if (generation !== previewGeneration) return;
      failedUntil.delete(attachmentId);
      // `null` is a durable miss (GC / 404). Transient failures throw and are not cached.
      previews.set(attachmentId, result ?? {});
    })
    .catch(() => {
      if (generation !== previewGeneration) return;
      failedUntil.set(attachmentId, Date.now() + PREVIEW_RETRY_MS);
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        bumpPreviews();
      }, PREVIEW_RETRY_MS);
      retryTimers.add(timer);
    })
    .finally(() => {
      if (generation !== previewGeneration) return;
      inflight.delete(attachmentId);
      bumpPreviews();
    });
}

export function resetAttachmentPreviews(): void {
  previewGeneration += 1;
  for (const timer of retryTimers) clearTimeout(timer);
  retryTimers.clear();
  previews.clear();
  inflight.clear();
  failedUntil.clear();
  bumpPreviews();
}

export function AttachmentPreviewProvider({
  resolve,
  children,
}: {
  resolve?: AttachmentPreviewResolve;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <AttachmentPreviewContext.Provider value={resolve ?? null}>
      {children}
    </AttachmentPreviewContext.Provider>
  );
}

/** `undefined` while the resolver is in flight, `null` when nothing is wired. */
export function useAttachmentPreview(attachmentId: string): AttachmentPreview | null | undefined {
  const resolve = useContext(AttachmentPreviewContext);
  useSyncExternalStore(subscribePreviews, previewStoreVersion);
  if (resolve === null) return null;
  const cached = previews.get(attachmentId);
  if (cached !== undefined) return cached;
  ensurePreview(attachmentId, resolve);
  return undefined;
}

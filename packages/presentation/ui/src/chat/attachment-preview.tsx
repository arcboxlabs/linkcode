import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';

export interface AttachmentPreview {
  url?: string;
  mimeType?: string;
}

export type AttachmentPreviewResolve = (attachmentId: string) => Promise<AttachmentPreview | null>;

const AttachmentPreviewContext = createContext<AttachmentPreviewResolve | null>(null);

const previews = new Map<string, AttachmentPreview>();
const inflight = new Set<string>();
const failedUntil = new Map<string, number>();
const attempts = new Map<string, number>();
const retryTimers = new Set<ReturnType<typeof setTimeout>>();
let previewGeneration = 0;
const previewListeners = new Set<() => void>();
const PREVIEW_RETRY_BASE_MS = 2000;
const PREVIEW_RETRY_MAX_ATTEMPTS = 5;

function subscribePreviews(onStoreChange: () => void): () => void {
  previewListeners.add(onStoreChange);
  return () => {
    previewListeners.delete(onStoreChange);
  };
}

function notifyPreviews(): void {
  for (const listener of previewListeners) listener();
}

function ensurePreview(attachmentId: string, resolve: AttachmentPreviewResolve): void {
  if (previews.has(attachmentId) || inflight.has(attachmentId)) return;
  const retryAt = failedUntil.get(attachmentId);
  if (retryAt !== undefined && retryAt > Date.now()) return;
  inflight.add(attachmentId);
  void fetchPreview(attachmentId, resolve, previewGeneration);
}

async function fetchPreview(
  attachmentId: string,
  resolve: AttachmentPreviewResolve,
  generation: number,
): Promise<void> {
  let result: AttachmentPreview | null;
  try {
    result = await resolve(attachmentId);
  } catch {
    if (generation !== previewGeneration) return;
    inflight.delete(attachmentId);
    scheduleRetry(attachmentId, resolve, generation);
    return;
  }
  if (generation !== previewGeneration) return;
  inflight.delete(attachmentId);
  attempts.delete(attachmentId);
  // `null` is a durable miss (GC / 404). Transient failures throw and retry with backoff.
  previews.set(attachmentId, result ?? {});
  notifyPreviews();
}

function scheduleRetry(
  attachmentId: string,
  resolve: AttachmentPreviewResolve,
  generation: number,
): void {
  const attempt = (attempts.get(attachmentId) ?? 0) + 1;
  if (attempt >= PREVIEW_RETRY_MAX_ATTEMPTS) {
    attempts.delete(attachmentId);
    previews.set(attachmentId, {});
    notifyPreviews();
    return;
  }
  attempts.set(attachmentId, attempt);
  const delay = PREVIEW_RETRY_BASE_MS * 2 ** (attempt - 1);
  failedUntil.set(attachmentId, Date.now() + delay);
  const timer = setTimeout(() => {
    retryTimers.delete(timer);
    if (generation !== previewGeneration) return;
    failedUntil.delete(attachmentId);
    ensurePreview(attachmentId, resolve);
  }, delay);
  retryTimers.add(timer);
}

export function resetAttachmentPreviews(): void {
  previewGeneration += 1;
  for (const timer of retryTimers) clearTimeout(timer);
  retryTimers.clear();
  previews.clear();
  inflight.clear();
  failedUntil.clear();
  attempts.clear();
  notifyPreviews();
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

/** `undefined` while the resolver is in flight, `null` when nothing is wired. The snapshot is the
 * cached entry itself: a version counter plus a render-time map read is memoized away by the React
 * Compiler, and the fetch runs in an effect so it lands after the switch-time reset, not before. */
export function useAttachmentPreview(attachmentId: string): AttachmentPreview | null | undefined {
  const resolve = useContext(AttachmentPreviewContext);
  const cached = useSyncExternalStore(subscribePreviews, () => previews.get(attachmentId));
  useEffect(() => {
    if (resolve !== null && cached === undefined) ensurePreview(attachmentId, resolve);
  }, [attachmentId, cached, resolve]);
  if (resolve === null) return null;
  return cached;
}

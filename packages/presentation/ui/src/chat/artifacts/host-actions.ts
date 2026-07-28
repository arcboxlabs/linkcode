import { createContext, useContext } from 'react';
import { artifactKindForPath } from './file-kind';

/** Host-side actions artifacts can trigger. In-process only — the sandboxed bridge
 * (CODE-64) adapts the same surface over JSON-RPC for iframe-hosted artifacts. */
export interface ArtifactHostActions {
  /** Insert a reference produced from an artifact interaction into the composer draft
   * (never auto-sends). */
  referenceToComposer: (text: string) => void;
  /** Open a workspace file in the host's viewer; relative paths anchor to the session cwd.
   * Absent (webview has no viewer) — cards then render without the open affordance. */
  openFile?: (path: string) => void;
  /** Play a workspace video in the host's browser surface (desktop: Browser pane), streamed
   * from the daemon with Range (CODE-316). Absent → video paths fall back to `openFile`. */
  openVideoPreview?: (path: string) => void;
  /** Open the workspace-change review surface. File results use this when the target no longer
   * exists (for example, a completed delete) or one adapter result spans multiple files. */
  reviewChanges?: () => void;
  /** Host inline content on the daemon's ephemeral per-artifact origin (CODE-62); absent when
   * the data plane can't host — the fence then renders as code. */
  hostArtifact?: (content: string, mimeType: string) => Promise<{ url: string }>;
  /** Promote a hosted artifact/preview URL to the host's browser surface (desktop:
   * Browser pane). Absent → the renderer falls back to a new browser tab. */
  openPreviewUrl?: (url: string) => void;
}

export type ArtifactNavigation = { kind: 'file'; path: string } | { kind: 'review' };

/** Resolve a presentation-owned navigation target against the actions its host actually wires. */
export function artifactNavigationAction(
  actions: ArtifactHostActions | null,
  navigation: ArtifactNavigation | null | undefined,
): (() => void) | undefined {
  if (!actions || !navigation) return undefined;
  if (navigation.kind === 'review') return actions.reviewChanges;
  const { path } = navigation;
  // Video plays in the host's browser surface, not the file viewer; fall back to openFile
  // when the host wires no video preview.
  if (artifactKindForPath(path) === 'video' && actions.openVideoPreview) {
    const openVideoPreview = actions.openVideoPreview;
    return () => openVideoPreview(path);
  }
  const openFile = actions.openFile;
  return openFile ? () => openFile(path) : undefined;
}

export const ArtifactHostActionsContext = createContext<ArtifactHostActions | null>(null);

/** Null when the artifact renders outside a surface that wires host actions —
 * renderers must keep working and simply drop the interaction affordance. */
export function useArtifactHostActions(): ArtifactHostActions | null {
  return useContext(ArtifactHostActionsContext);
}

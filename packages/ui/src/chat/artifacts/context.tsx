import { createContext, useContext } from 'react';

/** Host-side actions artifacts can trigger. In-process only — the sandboxed bridge
 * (CODE-64) adapts the same surface over JSON-RPC for iframe-hosted artifacts. */
export interface ArtifactHostActions {
  /** Insert a reference produced from an artifact interaction into the composer draft
   * (never auto-sends). */
  referenceToComposer: (text: string) => void;
  /** Open a workspace file in the host's viewer (desktop: right-panel files section).
   * Relative paths are anchored to the session cwd by the host. Absent when the shell
   * has no file viewer (webview) — cards then render without the open affordance. */
  openFile?: (path: string) => void;
  /** Open the workspace-change review surface. File results use this when the target no longer
   * exists (for example, a completed delete) or one adapter result spans multiple files. */
  reviewChanges?: () => void;
  /** Host inline content on the daemon's ephemeral per-artifact origin (CODE-62);
   * absent when the data plane doesn't support hosting — sandboxed previews then stay
   * unavailable and the fence renders as code. */
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
  const openFile = actions.openFile;
  return openFile ? () => openFile(navigation.path) : undefined;
}

const ArtifactHostActionsContext = createContext<ArtifactHostActions | null>(null);

export function ArtifactHostActionsProvider({
  actions,
  children,
}: {
  actions: ArtifactHostActions;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <ArtifactHostActionsContext.Provider value={actions}>
      {children}
    </ArtifactHostActionsContext.Provider>
  );
}

/** Null when the artifact renders outside a surface that wires host actions —
 * renderers must keep working and simply drop the interaction affordance. */
export function useArtifactHostActions(): ArtifactHostActions | null {
  return useContext(ArtifactHostActionsContext);
}

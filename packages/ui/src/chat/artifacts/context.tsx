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

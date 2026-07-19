import type { ArtifactHostActions } from './host-actions';
import { ArtifactHostActionsContext } from './host-actions';

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

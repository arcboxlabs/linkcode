import type { FileTab } from '@linkcode/ui/shell/files';
import { FileTabStrip, FileViewer } from '@linkcode/ui/shell/files';
import { useTranslations } from 'use-intl';
import { useWorkspaceFile } from './hooks';

export type { FileTab } from '@linkcode/ui/shell/files';

export interface FilesPanelProps {
  /** Workspace root the tab paths are read against. */
  cwd: string | undefined;
  tabs: FileTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

/** The right panel's Files section: viewer tabs for files opened from chat. */
export function FilesPanel({
  cwd,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
}: FilesPanelProps): React.ReactNode {
  const t = useTranslations('workbench.files');
  const active = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const { data, isLoading, error } = useWorkspaceFile(cwd, active?.path ?? null);

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground text-sm">
        {t('empty')}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FileTabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
      />
      <div className="min-h-0 flex-1">
        {active ? (
          <FileViewer path={active.path} file={data} isLoading={isLoading} error={error} />
        ) : null}
      </div>
    </div>
  );
}

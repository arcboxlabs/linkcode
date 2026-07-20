import { cn } from '@linkcode/ui';
import type { FileTab } from '@linkcode/ui/shell/files';
import { FileTabStrip, FileViewer, WorkspaceFileTree } from '@linkcode/ui/shell/files';
import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxact/create-fixed-array';
import { useTranslations } from 'use-intl';
import { useAppearancePrefsStore } from '../settings/appearance-store';
import { useWorkspaceFile, useWorkspaceFileList } from './hooks';

export type { FileTab } from '@linkcode/ui/shell/files';

const TREE_SKELETON_ROWS = createFixedArray(12);

export interface FilesPanelProps {
  /** Workspace root the tab paths are read against. */
  cwd: string | undefined;
  tabs: FileTab[];
  activeTabId: string | null;
  /** Shiki theme pairing for the code viewer — same axis the Diff section receives. */
  themeType?: 'system' | 'light' | 'dark';
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  /** Open a workspace file (cwd-relative path) as a viewer tab — tree clicks land here. */
  onOpenFile: (path: string) => void;
}

/** The right panel's Files section: viewer tabs plus a workspace tree docked to the side
 * the appearance preference selects (default right). Panes render in visual order so
 * keyboard traversal matches the layout. */
export function FilesPanel({
  cwd,
  tabs,
  activeTabId,
  themeType,
  onSelectTab,
  onCloseTab,
  onOpenFile,
}: FilesPanelProps): React.ReactNode {
  const t = useTranslations('workbench.files');
  const treeSide = useAppearancePrefsStore((state) => state.filesTreeSide);
  const active = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const { data, isLoading, error } = useWorkspaceFile(cwd, active?.path ?? null);
  const { data: treeFiles } = useWorkspaceFileList(cwd);

  const treePane = (
    <div
      className={cn(
        'w-56 shrink-0 overflow-hidden border-border',
        treeSide === 'left' ? 'border-r' : 'border-l',
      )}
    >
      {cwd === undefined ? (
        <div className="p-3 text-muted-foreground text-xs">{t('treeUnavailable')}</div>
      ) : treeFiles === undefined ? (
        <div className="flex flex-col gap-2 p-3">
          {TREE_SKELETON_ROWS.map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : (
        // Keyed per workspace: the tree model is built once per mount and must not
        // carry expansion/selection across roots.
        <WorkspaceFileTree key={cwd} paths={treeFiles} onFileOpen={onOpenFile} />
      )}
    </div>
  );

  const viewerPane = (
    // min-w-0: without it this flex item's min-width tracks the viewer's widest line and
    // long unwrapped content clips at the panel edge instead of scrolling inside the pre.
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {tabs.length === 0 ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground text-sm">
          {t('empty')}
        </div>
      ) : (
        <>
          <FileTabStrip
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={onSelectTab}
            onCloseTab={onCloseTab}
          />
          <div className="min-h-0 flex-1">
            {active ? (
              <FileViewer
                path={active.path}
                file={data}
                isLoading={isLoading}
                error={error}
                themeType={themeType}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      {treeSide === 'left' ? (
        <>
          {treePane}
          {viewerPane}
        </>
      ) : (
        <>
          {viewerPane}
          {treePane}
        </>
      )}
    </div>
  );
}

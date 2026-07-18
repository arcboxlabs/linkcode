import type { FileTree as PierreFileTreeModel } from '@pierre/trees';
import { FileTree as PierreFileTree, useFileTree } from '@pierre/trees/react';
import { InputGroup, InputGroupAddon, InputGroupInput } from 'coss-ui/components/input-group';
import { useStableHandler } from 'foxact/use-stable-handler-only-when-you-know-what-you-are-doing-or-you-will-be-fired';
import { SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';

export interface WorkspaceFileTreeProps {
  /** cwd-relative forward-slash file paths (`file.list` result); directories are implied. */
  paths: readonly string[];
  onFileOpen: (path: string) => void;
  className?: string;
}

/** Blend the shadow-DOM tree into the app theme: the `--trees-*-override` hooks are the
 * supported styling surface, and CSS custom properties inherit across the shadow boundary. */
const TREE_THEME_OVERRIDES = {
  '--trees-bg-override': 'transparent',
  '--trees-fg-override': 'var(--foreground)',
  '--trees-fg-muted-override': 'var(--muted-foreground)',
  '--trees-selected-bg-override': 'var(--muted)',
  '--trees-selected-fg-override': 'var(--foreground)',
  '--trees-accent-override': 'var(--accent)',
  '--trees-border-color-override': 'var(--border)',
  '--trees-font-family-override': 'var(--font-sans)',
  '--trees-font-size-override': '12px',
} as React.CSSProperties;

/**
 * Workspace tree for the Files section, rendered by `@pierre/trees` (shadow DOM, virtualized).
 * The built-in search UI stays off — it is unlocalizable inside the shadow root — and a
 * toolbar-height app search input drives `model.setSearch` instead. Selection state lives
 * inside the model; only file selections are reported — clicking a directory toggles it.
 */
export function WorkspaceFileTree({
  paths,
  onFileOpen,
  className,
}: WorkspaceFileTreeProps): React.ReactNode {
  const t = useTranslations('workbench.files');
  const [searchValue, setSearchValue] = useState('');
  const modelRef = useRef<PierreFileTreeModel | null>(null);
  const handleSelectionChange = useStableHandler((selected: readonly string[]) => {
    const path = selected[0];
    if (path === undefined) return;
    // isDirectory() !== false also drops paths the model no longer knows (mid-reset clicks).
    if (modelRef.current?.getItem(path)?.isDirectory() !== false) return;
    onFileOpen(path);
  });

  const { model } = useFileTree({
    paths,
    flattenEmptyDirectories: true,
    // Depth-1 expansion: top-level directories start open so a workspace whose files all
    // nest under one root does not collapse into a single unexpanded row.
    initialExpansion: 1,
    density: 'compact',
    fileTreeSearchMode: 'hide-non-matches',
    onSelectionChange: handleSelectionChange,
  });

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  // The model is constructed once per mount (useFileTree ignores option changes);
  // later path lists — refresh, SWR revalidation — are synced imperatively.
  const appliedPathsRef = useRef(paths);
  useEffect(() => {
    if (appliedPathsRef.current === paths) return;
    appliedPathsRef.current = paths;
    model.resetPaths(paths);
  }, [model, paths]);

  function applySearch(next: string): void {
    setSearchValue(next);
    model.setSearch(next === '' ? null : next);
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {/* Height matches the viewer pane's tab strip so the band's bottom border lines up
          across the tree divider. */}
      <div className="flex h-8 shrink-0 items-center border-border border-b bg-muted px-1">
        {/* ring-0!: important beats the group's has-[input:focus-visible]:ring-[3px] — this
            embedded field draws no chrome of its own inside the band. */}
        <InputGroup className="h-7 rounded-md border-0 bg-transparent shadow-none ring-0!">
          <InputGroupAddon>
            <SearchIcon className="text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={t('searchPlaceholder')}
            nativeInput
            placeholder={t('searchPlaceholder')}
            type="search"
            value={searchValue}
            onChange={(event) => applySearch(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.key === 'Process') return;
              if (event.key === 'Escape' && searchValue !== '') {
                event.stopPropagation();
                applySearch('');
              }
            }}
          />
        </InputGroup>
      </div>
      <PierreFileTree className="min-h-0 flex-1" model={model} style={TREE_THEME_OVERRIDES} />
    </div>
  );
}

import type { FileTree as PierreFileTreeModel } from '@pierre/trees';
import { FileTree as PierreFileTree, useFileTree } from '@pierre/trees/react';
import { useStableHandler } from 'foxact/use-stable-handler-only-when-you-know-what-you-are-doing-or-you-will-be-fired';
import { useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';

export interface WorkspaceFileTreeProps {
  /** cwd-relative forward-slash file paths (`file.list` result); directories are implied. */
  paths: readonly string[];
  onFileOpen: (path: string) => void;
  className?: string;
}

/**
 * Workspace tree for the Files section, rendered by `@pierre/trees` (shadow DOM, virtualized,
 * built-in search). Selection state lives inside the model; only file selections are reported —
 * clicking a directory toggles it.
 */
export function WorkspaceFileTree({
  paths,
  onFileOpen,
  className,
}: WorkspaceFileTreeProps): React.ReactNode {
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
    initialExpansion: 'closed',
    search: true,
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

  return <PierreFileTree className={cn('h-full min-h-0', className)} model={model} />;
}

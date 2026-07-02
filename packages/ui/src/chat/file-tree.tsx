import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { ChevronRightIcon, FileIcon, FolderIcon, FolderOpenIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { cn } from '../lib/cn';

const EMPTY_EXPANDED_IDS: ReadonlySet<string> = new Set();

// TODO(linkcode-schema): Provisional UI-only file tree node, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema file tree metadata when tool outputs expose structured trees.
export interface ChatFileTreeNode {
  id: string;
  name: string;
  path?: string;
  type: 'file' | 'directory';
  children?: ChatFileTreeNode[];
}

export type FileTreeProps = Omit<React.ComponentProps<'div'>, 'onSelect'> & {
  nodes?: readonly ChatFileTreeNode[];
  selectedId?: string;
  expandedIds?: ReadonlySet<string>;
  defaultExpandedIds?: Iterable<string>;
  onNodeSelect?: (node: ChatFileTreeNode) => void;
  onExpandedChange?: (expandedIds: Set<string>) => void;
};

export function FileTree({
  className,
  nodes,
  selectedId,
  expandedIds,
  defaultExpandedIds,
  onNodeSelect,
  onExpandedChange,
  children,
  ...props
}: FileTreeProps): React.ReactNode {
  const [internalExpandedIds, setInternalExpandedIds] = useState<Set<string>>(
    () => new Set(defaultExpandedIds),
  );
  const activeExpandedIds = expandedIds ?? internalExpandedIds;

  const toggle = useCallback(
    (nodeId: string) => {
      const next = new Set(activeExpandedIds);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      if (!expandedIds) setInternalExpandedIds(next);
      onExpandedChange?.(next);
    },
    [activeExpandedIds, expandedIds, onExpandedChange],
  );

  return (
    <div
      className={cn(
        'my-2 rounded-lg border border-border bg-card p-2 font-mono text-xs',
        className,
      )}
      role="tree"
      {...props}
    >
      {children ??
        nodes?.map((node) => (
          <FileTreeNode
            key={node.id}
            expandedIds={activeExpandedIds}
            node={node}
            selectedId={selectedId}
            onNodeSelect={onNodeSelect}
            onNodeToggle={toggle}
          />
        ))}
    </div>
  );
}

export type FileTreeNodeProps = Omit<React.ComponentProps<'div'>, 'onSelect' | 'onToggle'> & {
  node: ChatFileTreeNode;
  selectedId?: string;
  expandedIds?: ReadonlySet<string>;
  onNodeSelect?: (node: ChatFileTreeNode) => void;
  onNodeToggle?: (nodeId: string) => void;
};

export function FileTreeNode({
  className,
  node,
  selectedId,
  expandedIds = EMPTY_EXPANDED_IDS,
  onNodeSelect,
  onNodeToggle,
  ...props
}: FileTreeNodeProps): React.ReactNode {
  if (node.type === 'directory') {
    const isExpanded = expandedIds.has(node.id);
    return (
      <Collapsible open={isExpanded} onOpenChange={() => onNodeToggle?.(node.id)}>
        <div
          aria-selected={selectedId === node.id}
          className={className}
          role="treeitem"
          {...props}
        >
          <div
            className={cn(
              'flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted',
              selectedId === node.id && 'bg-muted',
            )}
          >
            <CollapsibleTrigger className="flex size-4 shrink-0 items-center justify-center">
              <ChevronRightIcon
                className={cn(
                  'size-3.5 text-muted-foreground transition-transform',
                  isExpanded && 'rotate-90',
                )}
              />
            </CollapsibleTrigger>
            <button
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              onClick={() => onNodeSelect?.(node)}
              type="button"
            >
              {isExpanded ? (
                <FolderOpenIcon className="size-3.5 shrink-0 text-info-foreground" />
              ) : (
                <FolderIcon className="size-3.5 shrink-0 text-info-foreground" />
              )}
              <span className="truncate">{node.name}</span>
            </button>
          </div>
          <CollapsibleContent>
            <div className="ml-3 border-l border-border pl-2">
              {node.children?.map((child) => (
                <FileTreeNode
                  key={child.id}
                  expandedIds={expandedIds}
                  node={child}
                  selectedId={selectedId}
                  onNodeSelect={onNodeSelect}
                  onNodeToggle={onNodeToggle}
                />
              ))}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    );
  }

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted',
        selectedId === node.id && 'bg-muted',
        className,
      )}
      aria-selected={selectedId === node.id}
      role="treeitem"
      {...props}
    >
      <span className="size-4 shrink-0" />
      <button
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={() => onNodeSelect?.(node)}
        type="button"
      >
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </button>
    </div>
  );
}

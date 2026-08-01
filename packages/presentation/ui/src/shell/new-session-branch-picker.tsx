import type { BranchMode, GitBranch, GitBranchSwitchCheck } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from 'coss-ui/components/input-group';
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from 'coss-ui/components/menu';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import {
  ChevronDownIcon,
  CopyIcon,
  GitBranchIcon,
  LaptopMinimalIcon,
  PlusIcon,
  SearchIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { CreateBranchDialog, SwitchBranchConflictDialog } from './new-session-branch-dialogs';

export interface NewSessionBranchPickerComponentProps {
  cwd: string;
  selectedBranch?: string;
  branchMode: BranchMode;
  disabled: boolean;
  onSelect: (branch: string) => void;
  onSelectMode: (mode: BranchMode) => void;
}

export type NewSessionBranchPickerComponent =
  React.ComponentType<NewSessionBranchPickerComponentProps>;

export interface NewSessionBranchPickerProps
  extends Omit<NewSessionBranchPickerComponentProps, 'cwd'> {
  currentBranch: string | null;
  dirtyFileCount: number;
  branches?: readonly GitBranch[];
  loading: boolean;
  error: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCheckSwitch: (branch: string) => Promise<GitBranchSwitchCheck>;
  onCreateBranch: (branch: string) => Promise<void>;
  onCommitChanges: (message: string) => Promise<void>;
}

/** Pure branch-menu presentation. Runtime-backed adapters supply repository state and branches. */
export function NewSessionBranchPicker({
  selectedBranch,
  branchMode,
  disabled,
  onSelect,
  onSelectMode,
  currentBranch,
  dirtyFileCount,
  branches,
  loading,
  error,
  open,
  onOpenChange,
  onCheckSwitch,
  onCreateBranch,
  onCommitChanges,
}: NewSessionBranchPickerProps): React.ReactNode {
  const t = useTranslations('workbench.newSession');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [switchConflict, setSwitchConflict] = useState<{
    branch: string;
    check: Extract<GitBranchSwitchCheck, { status: 'conflict' }>;
    selectLocal: boolean;
  } | null>(null);
  const visualBranch = selectedBranch ?? currentBranch ?? undefined;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleBranches =
    normalizedQuery.length === 0
      ? branches
      : branches?.filter((branch) => branch.name.toLowerCase().includes(normalizedQuery));

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) setQuery('');
    onOpenChange(nextOpen);
  }

  async function selectBranch(branch: string): Promise<void> {
    setActionError(null);
    if (branchMode === 'worktree' || branch === currentBranch) {
      onSelect(branch);
      return;
    }
    setChecking(true);
    try {
      const check = await onCheckSwitch(branch);
      if (check.status === 'conflict') {
        setSwitchConflict({ branch, check, selectLocal: false });
        return;
      }
      onSelect(branch);
    } catch (nextError) {
      setActionError(nextError);
      onOpenChange(true);
    } finally {
      setChecking(false);
    }
  }

  async function selectMode(mode: BranchMode): Promise<void> {
    if (mode === branchMode) return;
    setActionError(null);
    if (mode === 'worktree' || !selectedBranch || selectedBranch === currentBranch) {
      onSelectMode(mode);
      return;
    }
    setChecking(true);
    try {
      const check = await onCheckSwitch(selectedBranch);
      if (check.status === 'conflict') {
        setSwitchConflict({ branch: selectedBranch, check, selectLocal: true });
        return;
      }
      onSelectMode(mode);
    } catch (nextError) {
      setActionError(nextError);
      onOpenChange(true);
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <Menu open={open} onOpenChange={handleOpenChange}>
        <MenuTrigger
          aria-label={t('branch')}
          disabled={disabled || checking}
          render={
            <Button className="text-muted-foreground" size="sm" type="button" variant="ghost" />
          }
        >
          <GitBranchIcon />
          <span className="max-w-48 truncate">{visualBranch ?? t('branch')}</span>
          <ChevronDownIcon className="size-3 text-muted-foreground/72" />
        </MenuTrigger>
        <MenuPopup align="start" className="w-80" side="top" sideOffset={8}>
          <div
            className="mb-1"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <InputGroup className="border-0 bg-transparent shadow-none before:hidden has-[input:focus-visible]:ring-0">
              <InputGroupAddon>
                <SearchIcon className="text-muted-foreground" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label={t('branchSearch')}
                autoFocus
                disabled={loading}
                placeholder={t('branchSearch')}
                size="sm"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>
          </div>
          <MenuGroup>
            <MenuGroupLabel>{t('branches')}</MenuGroupLabel>
          </MenuGroup>
          {loading ? (
            <div className="px-2 py-1.5 text-muted-foreground text-sm">{t('branchLoading')}</div>
          ) : error ? (
            <div className="px-2 py-1.5 text-destructive text-sm">{t('branchError')}</div>
          ) : visibleBranches?.length ? (
            <MenuRadioGroup
              value={visualBranch ?? ''}
              onValueChange={(branch) => {
                selectBranch(branch).catch(noop);
              }}
            >
              {visibleBranches.map((branch) => (
                <MenuRadioItem key={branch.name} closeOnClick value={branch.name}>
                  <span className="flex min-w-0 items-start gap-2">
                    <GitBranchIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{branch.name}</span>
                      {branch.isCurrent && dirtyFileCount > 0 ? (
                        <span className="text-muted-foreground text-xs">
                          {t('branchUncommitted', { count: dirtyFileCount })}
                        </span>
                      ) : (
                        !branch.isCurrent && (
                          <span className="text-muted-foreground text-xs">
                            {branchMode === 'local'
                              ? t('branchLocalHint')
                              : t('branchWorktreeHint')}
                          </span>
                        )
                      )}
                    </span>
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          ) : (
            <div className="px-2 py-1.5 text-muted-foreground text-sm">
              {normalizedQuery ? t('branchNoMatches') : t('branchEmpty')}
            </div>
          )}
          {actionError != null && (
            <div className="px-2 py-1.5 text-destructive text-xs">
              {t('branchActionError', {
                message: extractErrorMessage(actionError, false) ?? '',
              })}
            </div>
          )}
          <MenuSeparator />
          <MenuItem
            closeOnClick
            onClick={() => {
              setActionError(null);
              setCreateOpen(true);
            }}
          >
            <PlusIcon />
            {t('branchCreate')}
          </MenuItem>
        </MenuPopup>
      </Menu>
      <Menu>
        <MenuTrigger
          aria-label={t('branchMode')}
          disabled={disabled || checking}
          render={
            <Button className="text-muted-foreground" size="sm" type="button" variant="ghost" />
          }
        >
          {branchMode === 'local' ? <LaptopMinimalIcon /> : <CopyIcon />}
          {branchMode === 'local' ? t('local') : t('worktree')}
          <ChevronDownIcon className="size-3 text-label-tertiary" />
        </MenuTrigger>
        <MenuPopup align="start" className="w-72" side="top" sideOffset={8}>
          <MenuRadioGroup
            value={branchMode}
            onValueChange={(value) => {
              if (value !== 'local' && value !== 'worktree') return;
              selectMode(value).catch(noop);
            }}
          >
            <MenuRadioItem closeOnClick value="local">
              <LaptopMinimalIcon />
              <span className="flex min-w-0 flex-col">
                <span>{t('local')}</span>
                <span className="text-muted-foreground text-xs">{t('localDescription')}</span>
              </span>
            </MenuRadioItem>
            <MenuRadioItem closeOnClick disabled={!selectedBranch} value="worktree">
              <CopyIcon />
              <span className="flex min-w-0 flex-col">
                <span>{t('worktree')}</span>
                <span className="text-muted-foreground text-xs">
                  {selectedBranch ? t('worktreeDescription') : t('worktreeRequiresBranch')}
                </span>
              </span>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
      <CreateBranchDialog
        branches={branches ?? []}
        open={createOpen}
        onCreate={onCreateBranch}
        onOpenChange={setCreateOpen}
        onSelect={onSelect}
      />
      <SwitchBranchConflictDialog
        conflict={switchConflict}
        onCommit={onCommitChanges}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSwitchConflict(null);
        }}
        onSelect={(branch) => {
          onSelect(branch);
          if (switchConflict?.selectLocal) onSelectMode('local');
        }}
      />
    </>
  );
}

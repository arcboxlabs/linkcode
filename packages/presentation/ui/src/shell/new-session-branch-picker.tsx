import type { GitBranch } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from 'coss-ui/components/menu';
import { ChevronDownIcon, GitBranchIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';

export interface NewSessionBranchPickerComponentProps {
  cwd: string;
  selectedBranch?: string;
  disabled: boolean;
  onSelect: (branch: string) => void;
}

export type NewSessionBranchPickerComponent =
  React.ComponentType<NewSessionBranchPickerComponentProps>;

export interface NewSessionBranchPickerProps
  extends Omit<NewSessionBranchPickerComponentProps, 'cwd'> {
  currentBranch: string | null;
  branches?: readonly GitBranch[];
  loading: boolean;
  error: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Pure branch-menu presentation. Runtime-backed adapters supply repository state and branches. */
export function NewSessionBranchPicker({
  selectedBranch,
  disabled,
  onSelect,
  currentBranch,
  branches,
  loading,
  error,
  open,
  onOpenChange,
}: NewSessionBranchPickerProps): React.ReactNode {
  const t = useTranslations('workbench.newSession');
  const visualBranch = selectedBranch ?? currentBranch ?? undefined;

  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger
        aria-label={t('branch')}
        disabled={disabled}
        render={
          <Button className="text-muted-foreground" size="sm" type="button" variant="ghost" />
        }
      >
        <GitBranchIcon />
        <span className="max-w-48 truncate">{visualBranch ?? t('branch')}</span>
        <ChevronDownIcon className="size-3 text-muted-foreground/72" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-72" side="top" sideOffset={8}>
        {loading ? (
          <div className="px-2 py-1.5 text-muted-foreground text-sm">{t('branchLoading')}</div>
        ) : error ? (
          <div className="px-2 py-1.5 text-destructive text-sm">{t('branchError')}</div>
        ) : branches?.length ? (
          <MenuRadioGroup value={visualBranch ?? ''} onValueChange={onSelect}>
            {branches.map((branch) => (
              <MenuRadioItem key={branch.name} closeOnClick value={branch.name}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{branch.name}</span>
                  {!branch.isCurrent && (
                    <span className="text-muted-foreground text-xs">{t('branchWorktreeHint')}</span>
                  )}
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        ) : (
          <div className="px-2 py-1.5 text-muted-foreground text-sm">{t('branchEmpty')}</div>
        )}
      </MenuPopup>
    </Menu>
  );
}

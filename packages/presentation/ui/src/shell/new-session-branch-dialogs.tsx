import type { GitBranch, GitBranchSwitchCheck } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from 'coss-ui/components/dialog';
import { Field, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Input } from 'coss-ui/components/input';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

interface CreateBranchDialogProps {
  branches: readonly GitBranch[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (branch: string) => Promise<void>;
  onSelect: (branch: string) => void;
}

type BranchNameIssue = 'required' | 'trailingSlash' | 'exists' | 'invalid';

export function CreateBranchDialog({
  branches,
  open,
  onOpenChange,
  onCreate,
  onSelect,
}: CreateBranchDialogProps): React.ReactNode {
  const t = useTranslations('workbench.newSession');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const branch = name.trim();
  const issue = branchNameIssue(branch, branches);
  const visibleIssue = name.length > 0 ? issue : null;

  function close(): void {
    if (pending) return;
    setName('');
    setError(null);
    onOpenChange(false);
  }

  async function submit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
    event.preventDefault();
    if (issue !== null) return;
    setPending(true);
    setError(null);
    try {
      await onCreate(branch);
      onSelect(branch);
      setName('');
      onOpenChange(false);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      disablePointerDismissal={pending}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <DialogPopup className="max-w-md" closeProps={{ disabled: pending }}>
        <DialogHeader>
          <DialogTitle>{t('branchCreateTitle')}</DialogTitle>
          <DialogDescription>{t('branchCreateDescription')}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            submit(event).catch(noop);
          }}
        >
          <DialogPanel>
            <Field name="branch" invalid={visibleIssue !== null || error != null}>
              <FieldLabel>{t('branchName')}</FieldLabel>
              <Input
                aria-invalid={visibleIssue !== null || error != null}
                autoFocus
                disabled={pending}
                placeholder={t('branchNamePlaceholder')}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
              <FieldError match={visibleIssue !== null || error != null}>
                {visibleIssue === null
                  ? error == null
                    ? null
                    : t('branchActionError', {
                        message: extractErrorMessage(error, false) ?? '',
                      })
                  : t(`branchNameError.${visibleIssue}`)}
              </FieldError>
            </Field>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button disabled={pending} size="sm" type="button" variant="ghost" onClick={close}>
              {t('cancel')}
            </Button>
            <Button disabled={pending || issue !== null} size="sm" type="submit">
              {pending ? t('branchCreating') : t('branchCreateAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

interface SwitchBranchConflictDialogProps {
  conflict: {
    branch: string;
    check: Extract<GitBranchSwitchCheck, { status: 'conflict' }>;
  } | null;
  onOpenChange: (open: boolean) => void;
  onCommit: (message: string) => Promise<void>;
  onSelect: (branch: string) => void;
}

export function SwitchBranchConflictDialog({
  conflict,
  onOpenChange,
  onCommit,
  onSelect,
}: SwitchBranchConflictDialogProps): React.ReactNode {
  const t = useTranslations('workbench.newSession');
  const [commitStep, setCommitStep] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function close(): void {
    if (pending) return;
    setCommitStep(false);
    setMessage('');
    setError(null);
    onOpenChange(false);
  }

  function startCommit(): void {
    setMessage(t('branchCommitDefaultMessage'));
    setCommitStep(true);
  }

  async function commit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
    event.preventDefault();
    const trimmed = message.trim();
    if (!conflict || !trimmed) return;
    setPending(true);
    setError(null);
    try {
      await onCommit(trimmed);
      onSelect(conflict.branch);
      setCommitStep(false);
      setMessage('');
      onOpenChange(false);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={conflict !== null}
      disablePointerDismissal={pending}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <DialogPopup className="max-w-lg" closeProps={{ disabled: pending }}>
        {commitStep ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('branchCommitTitle')}</DialogTitle>
              <DialogDescription>{t('branchCommitDescription')}</DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                commit(event).catch(noop);
              }}
            >
              <DialogPanel>
                <Field name="message" invalid={error != null}>
                  <FieldLabel>{t('branchCommitMessage')}</FieldLabel>
                  <Input
                    aria-invalid={error != null}
                    autoFocus
                    disabled={pending}
                    value={message}
                    onChange={(event) => {
                      setMessage(event.target.value);
                      setError(null);
                    }}
                  />
                  <FieldError match={error != null}>
                    {error != null &&
                      t('branchActionError', {
                        message: extractErrorMessage(error, false) ?? '',
                      })}
                  </FieldError>
                </Field>
              </DialogPanel>
              <DialogFooter variant="bare">
                <Button
                  disabled={pending}
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setCommitStep(false);
                    setError(null);
                  }}
                >
                  {t('back')}
                </Button>
                <Button disabled={pending || message.trim().length === 0} size="sm" type="submit">
                  {pending ? t('branchCommitting') : t('branchCommitAction')}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('branchConflictTitle')}</DialogTitle>
              <DialogDescription>{t('branchConflictDescription')}</DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-3">
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border bg-muted/32 p-2">
                {conflict?.check.files.map((file) => (
                  <div
                    className="flex min-w-0 items-center gap-2 px-1 py-0.5 font-mono text-xs"
                    key={file.path}
                  >
                    <span className="min-w-0 flex-1 truncate" title={file.path}>
                      {file.path}
                    </span>
                    {file.additions !== null && file.deletions !== null && (
                      <span className="flex shrink-0 gap-1 tabular-nums">
                        <span className="text-success-foreground">+{file.additions}</span>
                        <span className="text-destructive-foreground">-{file.deletions}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground text-sm">{t('branchConflictInstruction')}</p>
            </DialogPanel>
            <DialogFooter variant="bare">
              <Button size="sm" type="button" variant="ghost" onClick={close}>
                {t('cancel')}
              </Button>
              <Button size="sm" type="button" onClick={startCommit}>
                {t('branchConflictCommitAction')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}

function branchNameIssue(branch: string, branches: readonly GitBranch[]): BranchNameIssue | null {
  if (branch.length === 0) return 'required';
  if (branch.endsWith('/')) return 'trailingSlash';
  if (branches.some((candidate) => candidate.name === branch)) return 'exists';
  if (
    branch === '@' ||
    branch[0] === '-' ||
    branch[0] === '/' ||
    branch.endsWith('.') ||
    branch.includes('..') ||
    branch.includes('@{') ||
    branch.includes('//') ||
    hasInvalidBranchCharacter(branch) ||
    branch.split('/').some((part) => part[0] === '.' || part.endsWith('.lock'))
  ) {
    return 'invalid';
  }
  return null;
}

function hasInvalidBranchCharacter(branch: string): boolean {
  for (const character of branch) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint === 127 ||
      codePoint <= 32 ||
      '~^:?*[\\'.includes(character)
    ) {
      return true;
    }
  }
  return false;
}

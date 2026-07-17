import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { Badge } from 'coss-ui/components/badge';
import { BookTextIcon, TerminalIcon } from 'lucide-react';
import { useStore } from 'zustand';
import { FileIdentityIcon } from '../../chat/file-identity-icon';
import type { ComposerDirectiveState, DirectiveStatus } from './directive-state';
import { commandStatus, directiveStateFor, shellStatus } from './directive-state';

function useDirectiveState<T>(selector: (state: ComposerDirectiveState) => T): T {
  const [editor] = useLexicalComposerContext();
  return useStore(directiveStateFor(editor), selector);
}

const COMMAND_VARIANTS: Record<DirectiveStatus, 'error' | 'info' | 'warning'> = {
  supported: 'info',
  unknown: 'error',
  unsupported: 'warning',
};

export function CommandChip({ name }: { name: string }): React.ReactNode {
  const status = useDirectiveState((state) => commandStatus(name, state));
  return (
    <Badge className="mx-px align-middle" size="sm" variant={COMMAND_VARIANTS[status]}>
      <BookTextIcon aria-hidden />/{name}
    </Badge>
  );
}

export function ShellChip(): React.ReactNode {
  const status = useDirectiveState(shellStatus);
  return (
    <Badge
      className="mx-px align-middle"
      size="sm"
      variant={status === 'supported' ? 'secondary' : 'error'}
    >
      <TerminalIcon aria-hidden />$
    </Badge>
  );
}

const PATH_SEPARATOR_RE = /[/\\]/;

function basename(path: string): string {
  return path.split(PATH_SEPARATOR_RE).pop() || path;
}

export function MentionChip({ path }: { path: string }): React.ReactNode {
  return (
    <Badge className="mx-px align-middle" size="sm" title={path} variant="secondary">
      <FileIdentityIcon path={path} />
      {basename(path)}
    </Badge>
  );
}

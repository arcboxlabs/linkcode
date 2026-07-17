import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { Badge } from 'coss-ui/components/badge';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from 'coss-ui/components/menu';
import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';
import type { NodeKey } from 'lexical';
import { $createTextNode, $getNodeByKey, $getRoot } from 'lexical';
import { BookTextIcon, TerminalIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
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

interface RecoverableDirectiveChipProps {
  children: React.ReactNode;
  literal: string;
  nodeKey: NodeKey;
  reason: string;
  variant: 'error' | 'warning';
}

function RecoverableDirectiveChip({
  children,
  literal,
  nodeKey,
  reason,
  variant,
}: RecoverableDirectiveChipProps): React.ReactNode {
  const [editor] = useLexicalComposerContext();
  const t = useTranslations('workbench.composer');

  function convertToText(): void {
    directiveStateFor(editor).setState({ suppressed: literal });
    editor.update(
      () => {
        const node = $getNodeByKey(nodeKey);
        if (!node) return;
        const text = $createTextNode(literal);
        node.replace(text);
        // The directive's existing separator/arguments follow in sibling text. Select the draft
        // end so conversion cannot immediately reopen the `/` menu at the old token boundary.
        $getRoot().selectEnd();
      },
      { discrete: true },
    );
    editor.focus();
  }

  function removeDirective(): void {
    editor.update(
      () => {
        const node = $getNodeByKey(nodeKey);
        if (!node) return;
        node.selectNext(0, 0);
        node.remove(true);
      },
      { discrete: true },
    );
    editor.focus();
  }

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          delay={0}
          render={
            <MenuTrigger
              render={
                <Badge
                  className="mx-px align-middle"
                  render={<button type="button" />}
                  size="sm"
                  variant={variant}
                >
                  {children}
                </Badge>
              }
            />
          }
        />
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
      <MenuPopup align="start" finalFocus={false} side="top">
        <MenuItem onClick={convertToText}>{t('convertToText')}</MenuItem>
        <MenuItem onClick={removeDirective}>{t('removeDirective')}</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

export function CommandChip({
  name,
  nodeKey,
}: {
  name: string;
  nodeKey: NodeKey;
}): React.ReactNode {
  const status = useDirectiveState((state) => commandStatus(name, state));
  const t = useTranslations('workbench.composer');
  const contents = (
    <>
      <BookTextIcon aria-hidden />/{name}
    </>
  );
  if (status !== 'supported') {
    return (
      <RecoverableDirectiveChip
        literal={`/${name}`}
        nodeKey={nodeKey}
        reason={
          status === 'unknown' ? t('commandUnknown', { command: name }) : t('commandUnsupported')
        }
        variant={status === 'unknown' ? 'error' : 'warning'}
      >
        {contents}
      </RecoverableDirectiveChip>
    );
  }
  return (
    <Badge className="mx-px align-middle" size="sm" variant={COMMAND_VARIANTS[status]}>
      {contents}
    </Badge>
  );
}

export function ShellChip({ nodeKey }: { nodeKey: NodeKey }): React.ReactNode {
  const status = useDirectiveState(shellStatus);
  const t = useTranslations('workbench.composer');
  const contents = (
    <>
      <TerminalIcon aria-hidden />$
    </>
  );
  if (status === 'unsupported') {
    return (
      <RecoverableDirectiveChip
        literal="$"
        nodeKey={nodeKey}
        reason={t('shellUnsupported')}
        variant="error"
      >
        {contents}
      </RecoverableDirectiveChip>
    );
  }
  return (
    <Badge className="mx-px align-middle" size="sm" variant="secondary">
      {contents}
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

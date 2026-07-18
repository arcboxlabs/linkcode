import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { Badge } from 'coss-ui/components/badge';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from 'coss-ui/components/menu';
import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';
import type { NodeKey } from 'lexical';
import { BookTextIcon, TerminalIcon, TriangleAlertIcon } from 'lucide-react';
import { useId } from 'react';
import { useTranslations } from 'use-intl';
import { useStore } from 'zustand';
import { FileIdentityIcon } from '../../chat/file-identity-icon';
import type { ComposerDirectiveState, DirectivePlacementIssue } from './directive-state';
import { commandStatus, directiveStateFor, shellStatus } from './directive-state';
import { $convertDirectiveToText, $removeDirective } from './serialize';

function useDirectiveState<T>(selector: (state: ComposerDirectiveState) => T): T {
  const [editor] = useLexicalComposerContext();
  return useStore(directiveStateFor(editor), selector);
}

/** Match the editor's 14px text metrics and sit on its text bottom rather than centering around
 * the baseline (which made mixed chip/text lines visibly bounce). */
const CHIP_CLASS_NAME = 'mx-0.5 h-5 align-text-bottom text-sm sm:h-5 sm:text-sm';

function keepEnterActivationLocal(event: React.KeyboardEvent<HTMLButtonElement>): void {
  if (event.key === 'Enter') event.stopPropagation();
}

interface DirectiveChipProps {
  children: React.ReactNode;
  nodeKey: NodeKey;
  reason?: string;
  variant: 'error' | 'info' | 'secondary' | 'warning';
}

/** Every directive is an atomic token with an explicit edit escape hatch. Invalid placement or
 * support adds a visible alert glyph and tooltip; the persistent composer alert repeats it. */
function DirectiveChip({
  children,
  nodeKey,
  reason,
  variant,
}: DirectiveChipProps): React.ReactNode {
  const [editor] = useLexicalComposerContext();
  const disabled = useDirectiveState((state) => state.disabled);
  const t = useTranslations('workbench.composer');
  const generatedReasonId = useId();
  const reasonId = reason ? generatedReasonId : undefined;

  function convertToText(): void {
    if (disabled) return;
    editor.update(
      () => {
        const suppressedNodeKey = $convertDirectiveToText(nodeKey);
        if (suppressedNodeKey) {
          directiveStateFor(editor).setState((state) => ({
            suppressed: new Set(state.suppressed).add(suppressedNodeKey),
          }));
        }
      },
      { discrete: true },
    );
    editor.focus();
  }

  function removeDirective(): void {
    if (disabled) return;
    editor.update(() => $removeDirective(nodeKey), { discrete: true });
    editor.focus();
  }

  const badge = (
    <Badge
      aria-describedby={reasonId}
      aria-invalid={reason ? true : undefined}
      className={CHIP_CLASS_NAME}
      render={<button disabled={disabled} type="button" />}
      size="sm"
      variant={variant}
      onKeyDownCapture={keepEnterActivationLocal}
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </Badge>
  );
  const trigger = <MenuTrigger render={badge} />;
  return (
    <>
      <Menu>
        {reason ? (
          <Tooltip>
            <TooltipTrigger delay={300} render={trigger} />
            <TooltipContent>{reason}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
        <MenuPopup
          align="start"
          finalFocus={(closeType) => (closeType === 'keyboard' ? editor.getRootElement() : false)}
          side="top"
        >
          <MenuItem disabled={disabled} onClick={convertToText}>
            {t('convertToText')}
          </MenuItem>
          <MenuItem disabled={disabled} variant="destructive" onClick={removeDirective}>
            {t('removeDirective')}
          </MenuItem>
        </MenuPopup>
      </Menu>
      {reason ? (
        <span className="sr-only" id={reasonId}>
          {reason}
        </span>
      ) : null}
    </>
  );
}

function placementReason(
  issue: DirectivePlacementIssue | undefined,
  label: string,
  kind: 'command' | 'shell',
  t: ReturnType<typeof useTranslations<'workbench.composer'>>,
): string | undefined {
  if (issue === 'multiple') return t('multipleDirectives', { directive: label });
  if (issue === 'misplaced') {
    return kind === 'command' ? t('commandMisplaced') : t('shellMisplaced');
  }
  return undefined;
}

export function CommandChip({
  name,
  nodeKey,
}: {
  name: string;
  nodeKey: NodeKey;
}): React.ReactNode {
  const status = useDirectiveState((state) => commandStatus(name, state));
  const placement = useDirectiveState((state) => state.placementIssues[nodeKey]);
  const t = useTranslations('workbench.composer');
  const statusReason =
    status === 'unknown'
      ? t('commandUnknown', { command: name })
      : status === 'unsupported'
        ? t('commandUnsupported')
        : undefined;
  const reason = statusReason ?? placementReason(placement, `/${name}`, 'command', t);
  return (
    <DirectiveChip
      nodeKey={nodeKey}
      reason={reason}
      variant={
        status === 'unknown' ? 'error' : status === 'unsupported' || placement ? 'warning' : 'info'
      }
    >
      {reason ? (
        <TriangleAlertIcon aria-hidden className="size-3.5" />
      ) : (
        <BookTextIcon aria-hidden className="size-3.5" />
      )}
      /{name}
    </DirectiveChip>
  );
}

export function ShellChip({ nodeKey }: { nodeKey: NodeKey }): React.ReactNode {
  const status = useDirectiveState(shellStatus);
  const placement = useDirectiveState((state) => state.placementIssues[nodeKey]);
  const t = useTranslations('workbench.composer');
  const reason =
    (status === 'unsupported' ? t('shellUnsupported') : undefined) ??
    placementReason(placement, '$', 'shell', t);
  return (
    <DirectiveChip
      nodeKey={nodeKey}
      reason={reason}
      variant={status === 'unsupported' ? 'error' : placement ? 'warning' : 'secondary'}
    >
      {reason ? (
        <TriangleAlertIcon aria-hidden className="size-3.5" />
      ) : (
        <TerminalIcon aria-hidden className="size-3.5" />
      )}
      $
    </DirectiveChip>
  );
}

const PATH_SEPARATOR_RE = /[/\\]/;

function basename(path: string): string {
  return path.split(PATH_SEPARATOR_RE).pop() || path;
}

export function MentionChip({ path }: { path: string }): React.ReactNode {
  return (
    <Badge className={CHIP_CLASS_NAME} size="sm" title={path} variant="secondary">
      <FileIdentityIcon path={path} />
      {basename(path)}
    </Badge>
  );
}

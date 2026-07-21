import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from 'coss-ui/components/menu';
import { useCopyToClipboard } from 'coss-ui/hooks/use-copy-to-clipboard';
import {
  CheckIcon,
  CopyIcon,
  EllipsisIcon,
  FolderOpenIcon,
  PinIcon,
  PinOffIcon,
  SquarePenIcon,
  XIcon,
} from 'lucide-react';
import { useTranslations } from 'use-intl';
import { ShellIconButton } from './shell-control';

/** Which file manager the reveal item names — the host maps its platform onto this. */
export type FileManagerKind = 'darwin' | 'win32' | 'other';

/** One editor the host detected; `id` is opaque and travels back on open. */
export interface ThreadTitleMenuEditor {
  id: string;
  label: string;
}

export interface ThreadTitleMenuProps {
  /** Copied verbatim by the copy item. */
  title: string;
  pinned: boolean;
  fileManager: FileManagerKind;
  /** Detected editors; empty hides the open-in-editor item entirely. */
  editors: ThreadTitleMenuEditor[];
  onTogglePin: () => void;
  onReveal: () => void;
  onOpenInEditor: (editorId: string) => void;
  /** Stop the thread if live and drop it from the list. */
  onClose: () => void;
}

const REVEAL_KEY = {
  darwin: 'reveal.darwin',
  win32: 'reveal.win32',
  other: 'reveal.other',
} as const;

/** The chrome title's overflow menu: what you can do to the thread you're looking at. */
export function ThreadTitleMenu({
  title,
  pinned,
  fileManager,
  editors,
  onTogglePin,
  onReveal,
  onOpenInEditor,
  onClose,
}: ThreadTitleMenuProps): React.ReactNode {
  const t = useTranslations('workbench.threadMenu');
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  return (
    <Menu>
      <MenuTrigger
        render={
          <ShellIconButton label={t('label')}>
            <EllipsisIcon className="size-4" />
          </ShellIconButton>
        }
      />
      <MenuPopup align="end" className="min-w-52">
        <MenuGroup>
          <MenuItem className="gap-2" onClick={onTogglePin}>
            {pinned ? <PinOffIcon /> : <PinIcon />}
            {pinned ? t('unpin') : t('pin')}
          </MenuItem>
          <MenuItem className="gap-2" onClick={() => copyToClipboard(title)}>
            {isCopied ? <CheckIcon /> : <CopyIcon />}
            {t('copyTitle')}
          </MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuItem className="gap-2" onClick={onReveal}>
            <FolderOpenIcon />
            {t(REVEAL_KEY[fileManager])}
          </MenuItem>
          <EditorItem editors={editors} label={t('openInEditor')} onOpen={onOpenInEditor} />
        </MenuGroup>
        <MenuSeparator />
        <MenuItem className="gap-2" variant="destructive" onClick={onClose}>
          <XIcon />
          {t('close')}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/** Nothing detected hides the item, one install runs directly, several open a chooser. */
function EditorItem({
  editors,
  label,
  onOpen,
}: {
  editors: ThreadTitleMenuEditor[];
  label: string;
  onOpen: (editorId: string) => void;
}): React.ReactNode {
  const only = editors.length === 1 ? editors.at(0) : undefined;
  if (only !== undefined) {
    return (
      <MenuItem className="gap-2" onClick={() => onOpen(only.id)}>
        <SquarePenIcon />
        {label}
      </MenuItem>
    );
  }
  if (editors.length === 0) return null;

  return (
    <MenuSub>
      <MenuSubTrigger className="gap-2">
        <SquarePenIcon />
        {label}
      </MenuSubTrigger>
      <MenuSubPopup className="min-w-48">
        {editors.map((editor) => (
          <MenuItem key={editor.id} onClick={() => onOpen(editor.id)}>
            {editor.label}
          </MenuItem>
        ))}
      </MenuSubPopup>
    </MenuSub>
  );
}

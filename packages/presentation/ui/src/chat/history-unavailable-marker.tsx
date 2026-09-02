import { HistoryIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import {
  CHAT_DISCLOSURE_TEXT_CLASS_NAME,
  CHAT_DISCLOSURE_TITLE_CLASS_NAME,
  ChatDisclosureIconSlot,
} from './disclosure-header';

/** Stands where a turn's provider output would render when the daemon could not project it: the
 * prompt-only fallback for a lost, compacted, or never-recorded transcript. */
export function HistoryUnavailableMarker(): React.ReactNode {
  const t = useTranslations('workbench.conversation');
  return (
    <div className="my-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <ChatDisclosureIconSlot>
        <HistoryIcon />
      </ChatDisclosureIconSlot>
      <span className={CHAT_DISCLOSURE_TEXT_CLASS_NAME}>
        <span className={CHAT_DISCLOSURE_TITLE_CLASS_NAME}>{t('historyUnavailable')}</span>
      </span>
    </div>
  );
}

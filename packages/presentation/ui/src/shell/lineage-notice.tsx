import { Alert, AlertAction, AlertDescription } from 'coss-ui/components/alert';
import { Button } from 'coss-ui/components/button';
import { XIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import type { ConversationLineageNotice } from '../chat/types';

/** Above the composer while the viewer is off the active lineage. */
export function LineageNotice({ notice }: { notice: ConversationLineageNotice }): React.ReactNode {
  const t = useTranslations('workbench.conversation');
  const parked = notice.kind === 'parked';
  return (
    <Alert variant="info">
      <AlertDescription>
        {t(parked ? 'viewingEarlierVersion' : 'continuedElsewhere')}
      </AlertDescription>
      <AlertAction>
        <Button size="xs" type="button" variant="outline" onClick={notice.onJump}>
          {t(parked ? 'backToLatest' : 'jumpToLatest')}
        </Button>
        {notice.kind === 'elsewhere' ? (
          <Button
            aria-label={t('dismiss')}
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={notice.onDismiss}
          >
            <XIcon />
          </Button>
        ) : null}
      </AlertAction>
    </Alert>
  );
}

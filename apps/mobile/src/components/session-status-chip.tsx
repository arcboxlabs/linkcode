import type { SessionStatus } from '@linkcode/schema';
import { Chip } from 'heroui-native';
import { useTranslations } from 'use-intl';

const STATUS_COLOR = {
  starting: 'warning',
  idle: 'default',
  running: 'success',
  'awaiting-input': 'warning',
  stopped: 'default',
} as const satisfies Record<SessionStatus, 'default' | 'success' | 'warning'>;

export function SessionStatusChip({ status }: { status: SessionStatus }): React.ReactNode {
  const t = useTranslations('mobile.sessions.status');

  return (
    <Chip variant="soft" size="sm" color={STATUS_COLOR[status]}>
      <Chip.Label>{t(status)}</Chip.Label>
    </Chip>
  );
}

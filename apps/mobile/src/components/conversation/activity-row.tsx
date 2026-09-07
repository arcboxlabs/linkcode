import { CircularProgressIndicator, Column, Icon, Row, Text } from '@expo/ui/jetpack-compose';
import {
  clickable,
  defaultMinSize,
  fillMaxWidth,
  size,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import chevronRight from '../../../assets/icons/chevron-right.xml';
import expandMore from '../../../assets/icons/expand-more.xml';
import type { ReasoningRowProps, ToolRowProps } from './activity-row.types';

export function ToolRow({ title, status, onPress }: ToolRowProps): React.ReactNode {
  const colors = useAppMaterialColors();
  const t = useTranslations('mobile.chat');
  return (
    <ThemedHost matchContents={{ vertical: true }}>
      <Row
        verticalAlignment="center"
        horizontalArrangement={{ spacedBy: 8 }}
        modifiers={[
          fillMaxWidth(),
          defaultMinSize({ minHeight: 48 }),
          ...(onPress ? [clickable(onPress)] : []),
        ]}
      >
        <Text
          style={{ typography: 'bodyMedium' }}
          color={colors.onSurfaceVariant}
          maxLines={1}
          overflow="ellipsis"
          modifiers={[weight(1)]}
        >
          {title}
        </Text>
        {status === 'failed' ? (
          <Text style={{ typography: 'labelSmall' }} color={colors.error}>
            {t('failed')}
          </Text>
        ) : null}
        {status === 'in_progress' ? (
          <CircularProgressIndicator modifiers={[size(16, 16)]} />
        ) : onPress ? (
          <Icon source={chevronRight} size={18} tint={colors.onSurfaceVariant} />
        ) : null}
      </Row>
    </ThemedHost>
  );
}

export function ReasoningRow({ text, streaming }: ReasoningRowProps): React.ReactNode {
  const [expanded, setExpanded] = useState(false);
  const colors = useAppMaterialColors();
  const t = useTranslations('mobile.conversation');
  return (
    <ThemedHost matchContents={{ vertical: true }}>
      <Column modifiers={[fillMaxWidth()]}>
        <Row
          verticalAlignment="center"
          horizontalArrangement={{ spacedBy: 8 }}
          modifiers={[
            fillMaxWidth(),
            defaultMinSize({ minHeight: 48 }),
            clickable(() => setExpanded((current) => !current)),
          ]}
        >
          <Text
            style={{ typography: 'bodyMedium' }}
            color={colors.onSurfaceVariant}
            modifiers={[weight(1)]}
          >
            {t('reasoning')}
          </Text>
          {streaming ? <CircularProgressIndicator modifiers={[size(16, 16)]} /> : null}
          <Icon
            source={expanded ? expandMore : chevronRight}
            size={18}
            tint={colors.onSurfaceVariant}
          />
        </Row>
        {expanded ? (
          <Text style={{ typography: 'bodyMedium' }} color={colors.onSurfaceVariant}>
            {text}
          </Text>
        ) : null}
      </Column>
    </ThemedHost>
  );
}

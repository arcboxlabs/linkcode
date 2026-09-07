import {
  Button,
  DisclosureGroup,
  Host,
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  textSelection,
} from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import type { ReasoningRowProps, ToolRowProps } from './activity-row.types';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const BODY = font({ textStyle: 'subheadline' });

export function ToolRow({ title, status, onPress }: ToolRowProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  return (
    <Host matchContents={{ vertical: true }}>
      <Button onPress={onPress} modifiers={[buttonStyle('plain'), disabled(!onPress)]}>
        <HStack
          spacing={8}
          modifiers={[frame({ minHeight: 44, maxWidth: Number.POSITIVE_INFINITY })]}
        >
          <Text modifiers={[BODY, SECONDARY, lineLimit(1)]}>{title}</Text>
          <Spacer />
          {status === 'failed' ? (
            <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle('red')]}>
              {t('failed')}
            </Text>
          ) : null}
          {status === 'in_progress' ? (
            <ProgressView />
          ) : onPress ? (
            <Image systemName="chevron.right" size={13} modifiers={[SECONDARY]} />
          ) : null}
        </HStack>
      </Button>
    </Host>
  );
}

export function ReasoningRow({ text, streaming }: ReasoningRowProps): React.ReactNode {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslations('mobile.conversation');
  return (
    <Host matchContents={{ vertical: true }}>
      <DisclosureGroup isExpanded={expanded} onIsExpandedChange={setExpanded}>
        <DisclosureGroup.Label>
          <HStack spacing={8} modifiers={[frame({ minHeight: 44 })]}>
            <Text modifiers={[BODY, SECONDARY]}>{t('reasoning')}</Text>
            {streaming ? <ProgressView /> : null}
          </HStack>
        </DisclosureGroup.Label>
        <Text modifiers={[BODY, SECONDARY, textSelection(true)]}>{text}</Text>
      </DisclosureGroup>
    </Host>
  );
}

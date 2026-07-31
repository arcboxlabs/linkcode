import { DisclosureGroup, Gauge, Host, HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  frame,
  gaugeStyle,
  lineLimit,
  strikethrough,
} from '@expo/ui/swift-ui/modifiers';
import type { CurrentPlan } from '@linkcode/ui/native';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const STRIKE = strikethrough({ isActive: true, pattern: 'solid' });

const STATUS_ICON = {
  pending: 'circle',
  in_progress: 'circle.lefthalf.filled',
  completed: 'checkmark.circle.fill',
  cancelled: 'xmark.circle',
} as const;

/**
 * Desktop `StepPromptRow` equivalent: a collapsed `Step N/M · current entry` row with a
 * progress gauge, disclosing the full entry list in place.
 */
export function PlanTracker({ plan }: { plan: CurrentPlan }): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const [expanded, setExpanded] = useState(false);

  const entries = plan.item.plan.entries;
  const current = entries[plan.currentIndex];

  return (
    <View className="rounded-xl border border-border bg-surface-secondary/50 px-3 py-1.5">
      <Host matchContents>
        <DisclosureGroup isExpanded={expanded} onIsExpandedChange={setExpanded}>
          <DisclosureGroup.Label>
            <HStack spacing={8}>
              <Gauge
                value={plan.currentIndex + 1}
                max={plan.total}
                modifiers={[gaugeStyle('circularCapacity'), frame({ width: 18, height: 18 })]}
              />
              <Text modifiers={[font({ textStyle: 'footnote', weight: 'semibold' })]}>
                {t('stepLabel', {
                  current: plan.currentIndex + 1,
                  total: plan.total,
                })}
              </Text>
              <Text
                modifiers={[
                  font({ textStyle: 'footnote' }),
                  SECONDARY,
                  lineLimit(1),
                  ...(plan.complete ? [STRIKE] : []),
                ]}
              >
                {current.content}
              </Text>
            </HStack>
          </DisclosureGroup.Label>
          <VStack alignment="leading" spacing={6}>
            {entries.map((entry, index) => (
              <HStack
                // eslint-disable-next-line @eslint-react/no-array-index-key -- plan entries carry no id; plans replace wholesale
                key={index}
                spacing={8}
              >
                <Image
                  systemName={STATUS_ICON[entry.status]}
                  size={14}
                  modifiers={entry.status === 'completed' ? [] : [SECONDARY]}
                />
                <Text
                  modifiers={[
                    font({ textStyle: 'footnote' }),
                    ...(entry.status === 'completed' ? [SECONDARY, STRIKE] : []),
                  ]}
                >
                  {entry.content}
                </Text>
              </HStack>
            ))}
          </VStack>
        </DisclosureGroup>
      </Host>
    </View>
  );
}

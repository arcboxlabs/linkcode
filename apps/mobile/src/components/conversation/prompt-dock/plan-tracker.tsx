import { CircularProgressIndicator, Column, Row, Text } from '@expo/ui/jetpack-compose';
import { clickable, fillMaxWidth, size, weight } from '@expo/ui/jetpack-compose/modifiers';
import type { CurrentPlan } from '@linkcode/ui/native';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

/** Text stand-ins for the SF status glyphs — no icon assets on the Compose side. */
const STATUS_GLYPH = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  cancelled: '✕',
} as const;

/**
 * Android plan tracker, mirroring the SwiftUI DisclosureGroup: a collapsed `Step N/M · current
 * entry` row with a circular progress ring, expanding the full entry list in place on tap.
 */
export function PlanTracker({ plan }: { plan: CurrentPlan }): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const colors = useAppMaterialColors();
  const [expanded, setExpanded] = useState(false);

  const entries = plan.item.plan.entries;
  const current = entries[plan.currentIndex];

  return (
    <View
      className="rounded-xl border px-3 py-1.5"
      style={{ backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant }}
    >
      <ThemedHost matchContents={{ vertical: true }}>
        <Column modifiers={[fillMaxWidth()]}>
          <Row
            verticalAlignment="center"
            horizontalArrangement={{ spacedBy: 8 }}
            modifiers={[clickable(() => setExpanded((current_) => !current_)), fillMaxWidth()]}
          >
            <CircularProgressIndicator
              progress={(plan.currentIndex + 1) / plan.total}
              strokeWidth={2}
              modifiers={[size(18, 18)]}
            />
            <Text style={{ typography: 'labelLarge' }}>
              {t('stepLabel', { current: plan.currentIndex + 1, total: plan.total })}
            </Text>
            <Text
              style={{
                typography: 'bodySmall',
                textDecoration: plan.complete ? 'lineThrough' : 'none',
              }}
              color={colors.onSurfaceVariant}
              maxLines={1}
              overflow="ellipsis"
              modifiers={[weight(1)]}
            >
              {current.content}
            </Text>
          </Row>
          {expanded ? (
            <Column verticalArrangement={{ spacedBy: 6 }} modifiers={[fillMaxWidth()]}>
              {entries.map((entry, index) => (
                <Row
                  // eslint-disable-next-line @eslint-react/no-array-index-key -- plan entries carry no id; plans replace wholesale
                  key={index}
                  verticalAlignment="center"
                  horizontalArrangement={{ spacedBy: 8 }}
                >
                  <Text
                    style={{ typography: 'bodySmall' }}
                    color={entry.status === 'completed' ? colors.primary : colors.onSurfaceVariant}
                  >
                    {STATUS_GLYPH[entry.status]}
                  </Text>
                  <Text
                    style={{
                      typography: 'bodySmall',
                      textDecoration: entry.status === 'completed' ? 'lineThrough' : 'none',
                    }}
                    color={entry.status === 'completed' ? colors.onSurfaceVariant : undefined}
                    modifiers={[weight(1)]}
                  >
                    {entry.content}
                  </Text>
                </Row>
              ))}
            </Column>
          ) : null}
        </Column>
      </ThemedHost>
    </View>
  );
}

import { Icon, LazyColumn, PullToRefreshBox, Row, Text } from '@expo/ui/jetpack-compose';
import {
  clickable,
  defaultMinSize,
  fillMaxWidth,
  padding,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import { useState } from 'react';
import expandLessGlyph from '../../../../assets/icons/expand-less.xml';
import expandMoreGlyph from '../../../../assets/icons/expand-more.xml';
import type { ThreadListProps } from './thread-list.types';
import { ThreadRow } from './thread-row';
import { useThreadListState } from './use-thread-list-state';

// Each visible thread must be a direct LazyColumn child; grouping rows in a Column defeats laziness.
export function ThreadList({
  groups,
  labelFor,
  onOpenThread,
  onRefresh,
}: ThreadListProps): React.ReactNode {
  const { collapsed, setGroupExpanded, now } = useThreadListState();
  const colors = useAppMaterialColors();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    void onRefresh().finally(() => setRefreshing(false));
  };

  return (
    <ThemedHost style={{ flex: 1 }} useViewportSizeMeasurement>
      {/* expo-ui's indicator slot drops Compose's align(TopCenter); topCenter restores it, and the
       * fillMaxWidth child is unaffected. */}
      <PullToRefreshBox contentAlignment="topCenter" isRefreshing={refreshing} onRefresh={refresh}>
        <LazyColumn contentPadding={{ top: 4, bottom: 24 }} modifiers={[fillMaxWidth()]}>
          {groups.flatMap((group) => {
            const expanded = !collapsed.has(group.key);
            return [
              <Row
                key={`group:${group.key}`}
                verticalAlignment="center"
                modifiers={[
                  clickable(() => setGroupExpanded(group.key, !expanded)),
                  fillMaxWidth(),
                  defaultMinSize({ minHeight: 48 }),
                  padding(16, 14, 16, 4),
                ]}
              >
                <Text
                  style={{ typography: 'titleSmall' }}
                  color={colors.primary}
                  modifiers={[weight(1)]}
                  maxLines={1}
                  overflow="ellipsis"
                >
                  {labelFor(group)}
                </Text>
                <Icon
                  source={expanded ? expandLessGlyph : expandMoreGlyph}
                  size={20}
                  tint={colors.onSurfaceVariant}
                />
              </Row>,
              ...(expanded
                ? group.sessions.map((session) => (
                    <ThreadRow
                      key={`session:${session.sessionId}`}
                      session={session}
                      now={now}
                      onPress={() => onOpenThread(session.sessionId)}
                    />
                  ))
                : []),
            ];
          })}
        </LazyColumn>
      </PullToRefreshBox>
    </ThemedHost>
  );
}

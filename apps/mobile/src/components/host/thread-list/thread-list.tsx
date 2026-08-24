import {
  AnimatedVisibility,
  Column,
  EnterTransition,
  ExitTransition,
  Icon,
  LazyColumn,
  PullToRefreshBox,
  Row,
  Spacer,
  Text,
} from '@expo/ui/jetpack-compose';
import { clickable, fillMaxWidth, padding, weight } from '@expo/ui/jetpack-compose/modifiers';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import { Fragment, useState } from 'react';
import expandLessGlyph from '../../../../assets/icons/expand-less.xml';
import expandMoreGlyph from '../../../../assets/icons/expand-more.xml';
import type { ThreadListProps } from './thread-list.types';
import { ThreadRow } from './thread-row';
import { useThreadListState } from './use-thread-list-state';

/** Android thread inbox body. Compose has no collapsible Section: each group renders a clickable
 * MD3 subheader row with an expand chevron, and its rows collapse through `AnimatedVisibility`
 * (the M3 expand/shrink motion; rows stay mounted). PullToRefreshBox takes a controlled flag
 * instead of awaiting the promise, so the spinner state is adapted here. */
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
          {groups.map((group) => {
            const expanded = !collapsed.has(group.key);
            return (
              <Fragment key={group.key}>
                <Row
                  verticalAlignment="center"
                  modifiers={[
                    clickable(() => setGroupExpanded(group.key, !expanded)),
                    fillMaxWidth(),
                    padding(16, 14, 16, 4),
                  ]}
                >
                  <Text style={{ typography: 'titleSmall' }} color={colors.primary}>
                    {labelFor(group)}
                  </Text>
                  <Spacer modifiers={[weight(1)]} />
                  <Icon
                    source={expanded ? expandLessGlyph : expandMoreGlyph}
                    size={20}
                    tint={colors.onSurfaceVariant}
                  />
                </Row>
                <AnimatedVisibility
                  visible={expanded}
                  enterTransition={EnterTransition.expandVertically().plus(
                    EnterTransition.fadeIn(),
                  )}
                  exitTransition={ExitTransition.shrinkVertically().plus(ExitTransition.fadeOut())}
                >
                  <Column modifiers={[fillMaxWidth()]}>
                    {group.sessions.map((session) => (
                      <ThreadRow
                        key={session.sessionId}
                        session={session}
                        now={now}
                        onPress={() => onOpenThread(session.sessionId)}
                      />
                    ))}
                  </Column>
                </AnimatedVisibility>
              </Fragment>
            );
          })}
        </LazyColumn>
      </PullToRefreshBox>
    </ThemedHost>
  );
}

import {
  Host,
  LazyColumn,
  PullToRefreshBox,
  Row,
  Spacer,
  Text,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import { clickable, fillMaxWidth, padding, weight } from '@expo/ui/jetpack-compose/modifiers';
import { Fragment, useState } from 'react';
import type { ThreadListProps } from './thread-list.types';
import { ThreadRow } from './thread-row';
import { useThreadListState } from './use-thread-list-state';

/** Android thread inbox body. Compose has no collapsible Section: each group renders a clickable
 * MD3 subheader row and conditionally its rows. PullToRefreshBox takes a controlled flag instead
 * of awaiting the promise, so the spinner state is adapted here. */
export function ThreadList({
  groups,
  labelFor,
  onOpenThread,
  onRefresh,
}: ThreadListProps): React.ReactNode {
  const { collapsed, setGroupExpanded, now } = useThreadListState();
  const colors = useMaterialColors();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    void onRefresh().finally(() => setRefreshing(false));
  };

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <PullToRefreshBox isRefreshing={refreshing} onRefresh={refresh}>
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
                  <Text style={{ typography: 'labelMedium' }} color={colors.onSurfaceVariant}>
                    {expanded ? '▾' : '▸'}
                  </Text>
                </Row>
                {expanded
                  ? group.sessions.map((session) => (
                      <ThreadRow
                        key={session.sessionId}
                        session={session}
                        now={now}
                        onPress={() => onOpenThread(session.sessionId)}
                      />
                    ))
                  : null}
              </Fragment>
            );
          })}
        </LazyColumn>
      </PullToRefreshBox>
    </Host>
  );
}

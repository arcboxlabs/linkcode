import { useSessions } from '@linkcode/client-core';
import type { AgentKind } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { EmptyState, ScreenScroll } from '@linkcode/ui/native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  ListGroup,
  Spinner,
  TextField,
  useThemeColor,
} from 'heroui-native';
import { MessagesSquareIcon, SettingsIcon, SquareTerminalIcon } from 'lucide-react-native';
import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { HeaderIconButton } from '../../../components/navigation';
import { SessionStatusChip } from '../../../components/session-status-chip';

/** Session inbox for the connected host, plus an inline "new session" form. */
export default function SessionsScreen(): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const router = useRouter();
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { sessions, create, refresh, loading } = useSessions();
  const muted = useThemeColor('muted');

  const [kind, setKind] = useState<AgentKind>(AgentKindSchema.options[0]);
  const [cwd, setCwd] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const onCreate = async () => {
    const trimmedCwd = cwd.trim();
    if (!trimmedCwd || creating) return;
    setCreating(true);
    try {
      const sessionId = await create({ kind, cwd: trimmedCwd });
      setCwd('');
      router.push(`/host/${hostId}/session/${sessionId}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerLargeTitle: true,
          title: t('title'),
          headerRight: () => (
            <View className="flex-row">
              <HeaderIconButton
                icon={SquareTerminalIcon}
                label={t('terminals')}
                onPress={() => router.push(`/host/${hostId}/terminal`)}
              />
              <HeaderIconButton
                icon={SettingsIcon}
                label={t('settings')}
                onPress={() => router.push('/settings')}
              />
            </View>
          ),
        }}
      />
      <ScreenScroll
        keyboardAware
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <View className="items-center py-8">
            <Spinner />
          </View>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={<MessagesSquareIcon size={36} color={muted} strokeWidth={1.5} />}
            title={t('emptyTitle')}
            hint={t('emptyHint')}
          />
        ) : (
          <ListGroup>
            {sessions.map((session) => (
              <ListGroup.Item
                key={session.sessionId}
                onPress={() => router.push(`/host/${hostId}/session/${session.sessionId}`)}
              >
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>{session.kind}</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription numberOfLines={1}>
                    {session.cwd}
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
                <ListGroup.ItemSuffix>
                  <SessionStatusChip status={session.status} />
                </ListGroup.ItemSuffix>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}

        <Card>
          <Card.Header>
            <Card.Title>{t('newSession')}</Card.Title>
          </Card.Header>
          <Card.Body className="gap-4">
            <View className="gap-2">
              <Label>{t('kindLabel')}</Label>
              <View className="flex-row flex-wrap gap-2">
                {AgentKindSchema.options.map((option) => (
                  <Chip
                    key={option}
                    variant={kind === option ? 'primary' : 'soft'}
                    color={kind === option ? 'accent' : 'default'}
                    onPress={() => setKind(option)}
                  >
                    <Chip.Label>{option}</Chip.Label>
                  </Chip>
                ))}
              </View>
            </View>
            <TextField>
              <Label>{t('cwdLabel')}</Label>
              <Input
                value={cwd}
                onChangeText={setCwd}
                placeholder={t('cwdPlaceholder')}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </TextField>
            <Button onPress={onCreate} isDisabled={creating || cwd.trim().length === 0}>
              <Button.Label>{t('create')}</Button.Label>
            </Button>
          </Card.Body>
        </Card>
      </ScreenScroll>
    </>
  );
}

import { ScreenScroll, SectionLabel } from '@linkcode/ui/native';
import { Stack } from 'expo-router';
import { Button, ListGroup } from 'heroui-native';
import { Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { TERMINAL_THEMES } from '../constants/terminal-themes.generated';
import {
  TERMINAL_COLOR_SCHEMES,
  TERMINAL_FONT_SIZES,
  useTerminalPrefsStore,
} from '../stores/terminal-prefs-store';

/** Client-side terminal appearance: font size and color scheme. */
export default function TerminalAppearanceScreen(): React.ReactNode {
  const t = useTranslations('mobile.terminalAppearance');
  const fontSize = useTerminalPrefsStore((state) => state.fontSize);
  const colorScheme = useTerminalPrefsStore((state) => state.colorScheme);
  const setFontSize = useTerminalPrefsStore((state) => state.setFontSize);
  const setColorScheme = useTerminalPrefsStore((state) => state.setColorScheme);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('title') }} />
      <ScreenScroll>
        <View className="gap-2">
          <SectionLabel>{t('fontSize')}</SectionLabel>
          <View className="flex-row flex-wrap gap-2">
            {TERMINAL_FONT_SIZES.map((size) => (
              <Button
                key={size}
                size="sm"
                variant={size === fontSize ? 'primary' : 'secondary'}
                onPress={() => setFontSize(size)}
              >
                <Button.Label>{String(size)}</Button.Label>
              </Button>
            ))}
          </View>
        </View>

        <View className="gap-2">
          <SectionLabel>{t('colorScheme')}</SectionLabel>
          <ListGroup>
            {TERMINAL_COLOR_SCHEMES.map((scheme) => {
              const theme = scheme === 'auto' ? undefined : TERMINAL_THEMES[scheme];
              return (
                <ListGroup.Item key={scheme} onPress={() => setColorScheme(scheme)}>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>
                      {scheme === 'auto' ? t('colorSchemeAuto') : scheme}
                    </ListGroup.ItemTitle>
                    {scheme === 'auto' ? (
                      <ListGroup.ItemDescription>
                        {t('colorSchemeAutoHint')}
                      </ListGroup.ItemDescription>
                    ) : null}
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <View className="flex-row items-center gap-2">
                      {theme ? (
                        <ThemeSwatch background={theme.background} foreground={theme.foreground} />
                      ) : null}
                      {scheme === colorScheme ? (
                        <Text className="font-semibold text-accent text-base">✓</Text>
                      ) : null}
                    </View>
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              );
            })}
          </ListGroup>
        </View>
      </ScreenScroll>
    </>
  );
}

function ThemeSwatch({ background, foreground }: { background?: string; foreground?: string }) {
  return (
    <View
      className="h-6 w-6 items-center justify-center rounded-full border border-default"
      style={{ backgroundColor: background }}
    >
      <Text style={{ color: foreground, fontSize: 11, fontWeight: '600' }}>a</Text>
    </View>
  );
}

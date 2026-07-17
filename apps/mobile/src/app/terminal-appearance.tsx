import { ScreenScroll } from '@linkcode/ui/native';
import { useRouter } from 'expo-router';
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
  const tSettings = useTranslations('mobile.settings');
  const router = useRouter();
  const fontSize = useTerminalPrefsStore((state) => state.fontSize);
  const colorScheme = useTerminalPrefsStore((state) => state.colorScheme);
  const setFontSize = useTerminalPrefsStore((state) => state.setFontSize);
  const setColorScheme = useTerminalPrefsStore((state) => state.setColorScheme);

  return (
    <ScreenScroll title={t('title')}>
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
                      <Text className="text-base font-semibold text-accent">✓</Text>
                    ) : null}
                  </View>
                </ListGroup.ItemSuffix>
              </ListGroup.Item>
            );
          })}
        </ListGroup>
      </View>

      <Button variant="ghost" onPress={() => router.back()}>
        <Button.Label>{tSettings('back')}</Button.Label>
      </Button>
    </ScreenScroll>
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

function SectionLabel({ children }: React.PropsWithChildren) {
  return (
    <Text
      className="text-[11px] text-muted"
      style={{ fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' }}
    >
      {children}
    </Text>
  );
}

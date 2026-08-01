import {
  Circle,
  Form,
  Host,
  HStack,
  Picker,
  Section,
  Text,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  frame,
  pickerStyle,
  strokeBorder,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import {
  resolveTerminalTheme,
  TERMINAL_COLOR_SCHEMES,
  TERMINAL_FONT_SIZES,
  useTerminalPrefsStore,
} from '@mobile/stores/terminal-prefs-store';
import { Stack } from 'expo-router';
import { useTranslations } from 'use-intl';

const SWATCH = 24;

const HIERARCHICAL_SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });

/** Renders a theme's own colours so the row previews what it selects. `auto` has no theme
 *  of its own — it defers to ghostty's defaults — so it shows a neutral placeholder. */
function ThemeSwatch({ theme }: { theme?: { background?: string; foreground?: string } }) {
  return (
    <ZStack
      modifiers={[
        frame({ width: SWATCH, height: SWATCH }),
        // Light themes are nearly the row's own colour; the ring keeps them visible.
        strokeBorder({ color: 'secondary', shape: 'circle' }),
      ]}
    >
      <Circle
        modifiers={[theme?.background ? foregroundStyle(theme.background) : HIERARCHICAL_SECONDARY]}
      />
      {theme?.foreground ? (
        <Text
          modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(theme.foreground)]}
        >
          a
        </Text>
      ) : null}
    </ZStack>
  );
}

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
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section title={t('fontSize')}>
            <Picker
              selection={fontSize}
              onSelectionChange={setFontSize}
              modifiers={[pickerStyle('segmented')]}
            >
              {TERMINAL_FONT_SIZES.map((size) => (
                <Text key={size} modifiers={[tag(size)]}>
                  {String(size)}
                </Text>
              ))}
            </Picker>
          </Section>

          {/* An inline picker draws the selection checkmarks itself, so the rows only
              have to carry the swatch and the label. */}
          <Section title={t('colorScheme')}>
            <Picker
              selection={colorScheme}
              onSelectionChange={setColorScheme}
              modifiers={[pickerStyle('inline')]}
            >
              {TERMINAL_COLOR_SCHEMES.map((scheme) => {
                const theme = resolveTerminalTheme(scheme);
                return (
                  <HStack key={scheme} spacing={10} modifiers={[tag(scheme)]}>
                    <ThemeSwatch theme={theme} />
                    {scheme === 'auto' ? (
                      <VStack alignment="leading" spacing={2}>
                        <Text>{t('colorSchemeAuto')}</Text>
                        <Text modifiers={[font({ textStyle: 'footnote' }), HIERARCHICAL_SECONDARY]}>
                          {t('colorSchemeAutoHint')}
                        </Text>
                      </VStack>
                    ) : (
                      <Text>{scheme}</Text>
                    )}
                  </HStack>
                );
              })}
            </Picker>
          </Section>
        </Form>
      </Host>
    </>
  );
}

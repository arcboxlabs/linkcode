import {
  Box,
  Column,
  RadioButton,
  Row,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Text,
} from '@expo/ui/jetpack-compose';
import {
  background,
  border,
  clip,
  fillMaxWidth,
  padding,
  Shapes,
  selectable,
  selectableGroup,
  size,
} from '@expo/ui/jetpack-compose/modifiers';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { FormList } from '@mobile/components/form/list.android';
import { FormSection } from '@mobile/components/form/section.android';
import {
  resolveTerminalTheme,
  TERMINAL_COLOR_SCHEMES,
  TERMINAL_FONT_SIZES,
  useTerminalPrefsStore,
} from '@mobile/stores/terminal-prefs-store';
import { useTranslations } from 'use-intl';

const SWATCH = 24;

/** Renders a theme's own colours so the row previews what it selects. `auto` has no theme
 *  of its own — it defers to ghostty's defaults — so it shows a neutral placeholder. */
function ThemeSwatch({ theme }: { theme?: { background?: string; foreground?: string } }) {
  const colors = useAppMaterialColors();

  return (
    <Box
      contentAlignment="center"
      modifiers={[
        size(SWATCH, SWATCH),
        clip(Shapes.Circle),
        background(theme?.background ?? colors.surfaceVariant),
        // Light themes are nearly the row's own colour; the ring keeps them visible.
        border(1, colors.outlineVariant),
      ]}
    >
      {theme?.foreground ? (
        <Text style={{ fontSize: 12, fontWeight: '600' }} color={theme.foreground}>
          a
        </Text>
      ) : null}
    </Box>
  );
}

/** Android terminal appearance, mirroring `terminal-appearance-screen.ios.tsx`: the segmented
 * font-size picker maps to MD3 segmented buttons; the inline color-scheme picker becomes a
 * radio group, which draws the selection state the checkmarks carried on iOS. */
export function TerminalAppearanceScreen(): React.ReactNode {
  const t = useTranslations('mobile.terminalAppearance');
  const colors = useAppMaterialColors();
  const fontSize = useTerminalPrefsStore((state) => state.fontSize);
  const colorScheme = useTerminalPrefsStore((state) => state.colorScheme);
  const setFontSize = useTerminalPrefsStore((state) => state.setFontSize);
  const setColorScheme = useTerminalPrefsStore((state) => state.setColorScheme);

  return (
    <FormList>
      <FormSection title={t('fontSize')}>
        <SingleChoiceSegmentedButtonRow modifiers={[padding(16, 6, 16, 10), fillMaxWidth()]}>
          {TERMINAL_FONT_SIZES.map((candidate) => (
            <SegmentedButton
              key={candidate}
              selected={fontSize === candidate}
              onClick={() => setFontSize(candidate)}
            >
              <SegmentedButton.Label>
                <Text>{String(candidate)}</Text>
              </SegmentedButton.Label>
            </SegmentedButton>
          ))}
        </SingleChoiceSegmentedButtonRow>
      </FormSection>

      <FormSection title={t('colorScheme')}>
        <Column modifiers={[selectableGroup()]}>
          {TERMINAL_COLOR_SCHEMES.map((scheme) => {
            const theme = resolveTerminalTheme(scheme);
            const selected = colorScheme === scheme;
            return (
              <Row
                key={scheme}
                verticalAlignment="center"
                horizontalArrangement={{ spacedBy: 10 }}
                modifiers={[
                  selectable(selected, () => setColorScheme(scheme), 'radioButton'),
                  fillMaxWidth(),
                  padding(16, 8, 16, 8),
                ]}
              >
                <RadioButton selected={selected} />
                <ThemeSwatch theme={theme} />
                {scheme === 'auto' ? (
                  <Column verticalArrangement={{ spacedBy: 2 }}>
                    <Text>{t('colorSchemeAuto')}</Text>
                    <Text style={{ typography: 'bodySmall' }} color={colors.onSurfaceVariant}>
                      {t('colorSchemeAutoHint')}
                    </Text>
                  </Column>
                ) : (
                  <Text>{scheme}</Text>
                )}
              </Row>
            );
          })}
        </Column>
      </FormSection>
    </FormList>
  );
}

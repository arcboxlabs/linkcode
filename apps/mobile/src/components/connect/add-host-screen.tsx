import { Button, Column, OutlinedTextField, Text, useNativeState } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, padding, testID } from '@expo/ui/jetpack-compose/modifiers';
import { useAddHost } from '@mobile/components/connect/use-add-host';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import { Stack } from 'expo-router';
import { useTranslations } from 'use-intl';

/** Android add-host form. The iOS header bar items (`unstable_header*Items`) don't exist on
 * Android, so submit is an in-form button and dismissal is the sheet's own back/swipe. */
export function AddHostScreen(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const colors = useAppMaterialColors();
  const name = useNativeState('');
  const url = useNativeState('');
  const { urlInvalid, urlValid, onUrlChange, submit } = useAddHost();

  const submitFields = () => submit(name.get(), url.get());

  return (
    <>
      <Stack.Screen options={{ title: t('add') }} />
      <ThemedHost style={{ flex: 1 }} useViewportSizeMeasurement>
        <Column verticalArrangement={{ spacedBy: 12 }} modifiers={[padding(16, 16, 16, 16)]}>
          <OutlinedTextField
            value={name}
            singleLine
            keyboardOptions={{ capitalization: 'none', autoCorrectEnabled: false }}
            modifiers={[testID('host-name-input'), fillMaxWidth()]}
          >
            <OutlinedTextField.Label>
              <Text>{t('nameLabel')}</Text>
            </OutlinedTextField.Label>
            <OutlinedTextField.Placeholder>
              <Text color={colors.onSurfaceVariant}>{t('namePlaceholder')}</Text>
            </OutlinedTextField.Placeholder>
          </OutlinedTextField>
          <OutlinedTextField
            value={url}
            singleLine
            isError={urlInvalid}
            onValueChange={onUrlChange}
            keyboardOptions={{
              keyboardType: 'uri',
              capitalization: 'none',
              autoCorrectEnabled: false,
              imeAction: 'go',
            }}
            keyboardActions={{ onGo: submitFields }}
            modifiers={[testID('host-url-input'), fillMaxWidth()]}
          >
            <OutlinedTextField.Label>
              <Text>{t('urlLabel')}</Text>
            </OutlinedTextField.Label>
            <OutlinedTextField.Placeholder>
              <Text color={colors.onSurfaceVariant}>{t('urlPlaceholder')}</Text>
            </OutlinedTextField.Placeholder>
            <OutlinedTextField.SupportingText>
              <Text>{urlInvalid ? t('invalidUrl') : t('emptyHint')}</Text>
            </OutlinedTextField.SupportingText>
          </OutlinedTextField>
          <Button enabled={urlValid} onClick={submitFields} modifiers={[fillMaxWidth()]}>
            <Text>{t('add')}</Text>
          </Button>
        </Column>
      </ThemedHost>
    </>
  );
}

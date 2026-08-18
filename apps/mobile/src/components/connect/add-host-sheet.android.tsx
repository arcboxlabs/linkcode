import {
  Button,
  Column,
  ModalBottomSheet,
  OutlinedTextField,
  Text,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth, imePadding, padding, testID } from '@expo/ui/jetpack-compose/modifiers';
import { useAddHost } from '@mobile/components/connect/use-add-host';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import { useTranslations } from 'use-intl';

/** Android add-host form as an MD3 bottom sheet — the same modal family as the host and model
 * switchers. A successful submit dismisses to the threads tab, which unmounts the sheet. */
export function AddHostSheet({
  isPresented,
  onIsPresentedChange,
}: {
  isPresented: boolean;
  onIsPresentedChange: (isPresented: boolean) => void;
}): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const colors = useAppMaterialColors();
  const name = useNativeState('');
  const url = useNativeState('');
  const { urlInvalid, urlValid, onUrlChange, submit } = useAddHost();

  if (!isPresented) return null;

  const submitFields = () => submit(name.get(), url.get());

  return (
    <ThemedHost style={{ position: 'absolute' }} pointerEvents="box-none">
      <ModalBottomSheet onDismissRequest={() => onIsPresentedChange(false)}>
        <Column
          verticalArrangement={{ spacedBy: 12 }}
          modifiers={[padding(16, 4, 16, 24), imePadding()]}
        >
          <Text style={{ typography: 'titleSmall' }} color={colors.primary}>
            {t('add')}
          </Text>
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
      </ModalBottomSheet>
    </ThemedHost>
  );
}

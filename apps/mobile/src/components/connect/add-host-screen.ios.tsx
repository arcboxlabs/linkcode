import { Form, Host, HStack, Section, Text, TextField, useNativeState } from '@expo/ui/swift-ui';
import {
  autocorrectionDisabled,
  keyboardType,
  onSubmit,
  submitLabel,
  textContentType,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import { useAddHost } from '@mobile/runtime/use-add-host';
import { Stack, useRouter } from 'expo-router';
import { useTranslations } from 'use-intl';

export function AddHostScreen(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const router = useRouter();
  const name = useNativeState('');
  const url = useNativeState('');
  const { urlInvalid, urlValid, onUrlChange, submit } = useAddHost();

  const submitFields = () => submit(name.get(), url.get());

  return (
    <>
      <Stack.Screen
        options={{
          title: t('add'),
          unstable_headerLeftItems: () => [
            {
              type: 'button',
              label: t('cancel'),
              accessibilityLabel: t('cancel'),
              icon: { type: 'sfSymbol', name: 'xmark' },
              onPress: () => router.dismiss(),
            },
          ],
          unstable_headerRightItems: () => [
            {
              type: 'button',
              label: t('add'),
              accessibilityLabel: t('add'),
              icon: { type: 'sfSymbol', name: 'checkmark' },
              variant: 'prominent',
              disabled: !urlValid,
              onPress: submitFields,
            },
          ],
        }}
      />
      {/* Form needs the viewport as its proposed size, otherwise it collapses to its content. */}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section footer={<Text>{urlInvalid ? t('invalidUrl') : t('emptyHint')}</Text>}>
            {/* `LabeledContent` only gives the field its intrinsic width; the stack fills the row. */}
            <HStack spacing={12}>
              <Text>{t('nameLabel')}</Text>
              <TextField
                testID="host-name-input"
                text={name}
                placeholder={t('namePlaceholder')}
                modifiers={[textInputAutocapitalization('never'), autocorrectionDisabled()]}
              />
            </HStack>
            <HStack spacing={12}>
              <Text>{t('urlLabel')}</Text>
              <TextField
                testID="host-url-input"
                text={url}
                placeholder={t('urlPlaceholder')}
                onTextChange={onUrlChange}
                modifiers={[
                  textInputAutocapitalization('never'),
                  autocorrectionDisabled(),
                  keyboardType('url'),
                  textContentType('URL'),
                  submitLabel('go'),
                  onSubmit(submitFields),
                ]}
              />
            </HStack>
          </Section>
        </Form>
      </Host>
    </>
  );
}

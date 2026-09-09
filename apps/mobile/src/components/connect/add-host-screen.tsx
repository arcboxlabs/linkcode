import { Form, Host, HStack, Section, Text, TextField, useNativeState } from '@expo/ui/swift-ui';
import {
  autocorrectionDisabled,
  keyboardType,
  onSubmit,
  submitLabel,
  textContentType,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import { HostUrlSchema, useHostRegistryStore } from '@mobile/stores/host-store';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

export function AddHostScreen(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const router = useRouter();
  const addHost = useHostRegistryStore((state) => state.addHost);
  const setLastActiveHostId = useHostRegistryStore((state) => state.setLastActiveHostId);
  const name = useNativeState('');
  const url = useNativeState('');
  const [urlInvalid, setUrlInvalid] = useState(false);
  const [urlValid, setUrlValid] = useState(false);

  const submit = () => {
    const trimmedUrl = url.get().trim();
    if (!HostUrlSchema.safeParse(trimmedUrl).success) {
      setUrlInvalid(true);
      return;
    }
    const profile = addHost({ name: name.get().trim() || t('namePlaceholder'), url: trimmedUrl });
    setLastActiveHostId(profile.id);
    router.dismissTo('/threads');
  };

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
              onPress: submit,
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
                onTextChange={(text) => {
                  setUrlInvalid(false);
                  setUrlValid(HostUrlSchema.safeParse(text.trim()).success);
                }}
                modifiers={[
                  textInputAutocapitalization('never'),
                  autocorrectionDisabled(),
                  keyboardType('url'),
                  textContentType('URL'),
                  submitLabel('go'),
                  onSubmit(submit),
                ]}
              />
            </HStack>
          </Section>
        </Form>
      </Host>
    </>
  );
}

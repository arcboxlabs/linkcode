import {
  Button,
  DisclosureGroup,
  HStack,
  Section,
  Text,
  TextField,
  useNativeState,
} from '@expo/ui/swift-ui';
import {
  autocorrectionDisabled,
  keyboardType,
  onSubmit,
  submitLabel,
  textContentType,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import { useOpenHost } from '@mobile/runtime/use-open-host';
import { HostUrlSchema, useHostRegistryStore } from '@mobile/stores/host-store';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

/** Manual host entry: add a daemon by URL and open it. */
export function ManualHostSection({
  startsExpanded,
}: {
  startsExpanded: boolean;
}): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const openHost = useOpenHost();
  const addHost = useHostRegistryStore((state) => state.addHost);

  // Null until the user decides either way. Seeding `useState` from `startsExpanded` would freeze
  // the value taken during the account's `loading` render, leaving a signed-in user's form open.
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [urlInvalid, setUrlInvalid] = useState(false);
  // The fields are backed by native state rather than mirrored into React: `get()` reads what
  // the field itself holds, so submitting never depends on a change event reaching JS first.
  const name = useNativeState('');
  const url = useNativeState('');

  const submit = () => {
    const trimmedUrl = url.get().trim();
    if (!HostUrlSchema.safeParse(trimmedUrl).success) {
      setUrlInvalid(true);
      return;
    }
    const profile = addHost({ name: name.get().trim() || t('namePlaceholder'), url: trimmedUrl });
    name.set('');
    url.set('');
    setUrlInvalid(false);
    openHost(profile.id);
  };

  return (
    <Section footer={<Text>{urlInvalid ? t('invalidUrl') : t('emptyHint')}</Text>}>
      <DisclosureGroup
        label={t('addManually')}
        isExpanded={expanded ?? startsExpanded}
        onIsExpandedChange={setExpanded}
      >
        {/* `LabeledContent` sizes the field to its text, leaving the rest of the row
            untappable; an HStack lets the field take the remaining width. */}
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
            onTextChange={() => setUrlInvalid(false)}
            modifiers={[
              textInputAutocapitalization('never'),
              autocorrectionDisabled(),
              keyboardType('url'),
              textContentType('URL'),
              // The URL is the only required field, so the return key finishes the form.
              submitLabel('go'),
              onSubmit(submit),
            ]}
          />
        </HStack>
        <Button label={t('add')} onPress={submit} />
      </DisclosureGroup>
    </Section>
  );
}

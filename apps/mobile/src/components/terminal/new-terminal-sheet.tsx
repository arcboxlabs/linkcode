import {
  BottomSheet,
  Button,
  Form,
  Host,
  HStack,
  Section,
  Text,
  TextField,
  useNativeState,
} from '@expo/ui/swift-ui';
import {
  autocorrectionDisabled,
  disabled,
  foregroundStyle,
  onSubmit,
  submitLabel,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslations } from 'use-intl';

export function NewTerminalSheet({
  isPresented,
  onIsPresentedChange,
  creating,
  error,
  onCreate,
}: {
  isPresented: boolean;
  onIsPresentedChange: (isPresented: boolean) => void;
  creating: boolean;
  error: string | null;
  onCreate: (cwd: string) => Promise<boolean>;
}): React.ReactNode {
  const t = useTranslations('mobile.terminals');
  const cwd = useNativeState('');

  const create = () => {
    if (creating) return;
    void onCreate(cwd.get().trim()).then((created) => {
      if (created) cwd.set('');
    });
  };

  return (
    <Host style={{ position: 'absolute' }} pointerEvents="box-none">
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={onIsPresentedChange}
        fitToContents
      >
        <Form>
          {error ? (
            <Section>
              <Text modifiers={[foregroundStyle('red')]}>{t('createError', { error })}</Text>
            </Section>
          ) : null}

          <Section title={t('newTerminal')}>
            <HStack spacing={12}>
              <Text>{t('cwdLabel')}</Text>
              <TextField
                testID="terminal-cwd-input"
                text={cwd}
                placeholder={t('cwdPlaceholder')}
                modifiers={[
                  textInputAutocapitalization('never'),
                  autocorrectionDisabled(),
                  submitLabel('go'),
                  onSubmit(create),
                ]}
              />
            </HStack>
          </Section>

          <Section>
            <Button
              label={creating ? t('creating') : t('create')}
              onPress={create}
              modifiers={[disabled(creating)]}
            />
          </Section>
        </Form>
      </BottomSheet>
    </Host>
  );
}

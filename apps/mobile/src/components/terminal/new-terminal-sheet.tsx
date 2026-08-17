import {
  Button,
  Column,
  Host,
  ModalBottomSheet,
  OutlinedTextField,
  Text,
  useMaterialColors,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth, imePadding, padding, testID } from '@expo/ui/jetpack-compose/modifiers';
import { useTranslations } from 'use-intl';
import type { NewTerminalSheetProps } from './new-terminal-sheet.types';

/** Android new-terminal sheet. Compose's ModalBottomSheet has no `isPresented` — mounting shows
 * it — so this renders nothing while closed and maps dismissal back through the prop. */
export function NewTerminalSheet({
  isPresented,
  onIsPresentedChange,
  creating,
  error,
  onCreate,
}: NewTerminalSheetProps): React.ReactNode {
  const t = useTranslations('mobile.terminals');
  const colors = useMaterialColors();
  const cwd = useNativeState('');

  if (!isPresented) return null;

  const create = () => {
    if (creating) return;
    void onCreate(cwd.get().trim()).then((created) => {
      if (created) cwd.set('');
    });
  };

  return (
    <Host style={{ position: 'absolute' }} pointerEvents="box-none">
      <ModalBottomSheet onDismissRequest={() => onIsPresentedChange(false)}>
        <Column
          verticalArrangement={{ spacedBy: 12 }}
          modifiers={[padding(16, 4, 16, 24), imePadding()]}
        >
          <Text style={{ typography: 'titleSmall' }} color={colors.primary}>
            {t('newTerminal')}
          </Text>
          {error ? (
            <Text style={{ typography: 'bodyMedium' }} color={colors.error}>
              {t('createError', { error })}
            </Text>
          ) : null}
          <OutlinedTextField
            value={cwd}
            singleLine
            keyboardOptions={{
              capitalization: 'none',
              autoCorrectEnabled: false,
              imeAction: 'go',
            }}
            keyboardActions={{ onGo: create }}
            modifiers={[testID('terminal-cwd-input'), fillMaxWidth()]}
          >
            <OutlinedTextField.Label>
              <Text>{t('cwdLabel')}</Text>
            </OutlinedTextField.Label>
            <OutlinedTextField.Placeholder>
              <Text color={colors.onSurfaceVariant}>{t('cwdPlaceholder')}</Text>
            </OutlinedTextField.Placeholder>
          </OutlinedTextField>
          <Button enabled={!creating} onClick={create} modifiers={[fillMaxWidth()]}>
            <Text>{creating ? t('creating') : t('create')}</Text>
          </Button>
        </Column>
      </ModalBottomSheet>
    </Host>
  );
}

import { Card, Column, Text } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, paddingAll } from '@expo/ui/jetpack-compose/modifiers';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import type { TranscriptRecordProps } from './transcript-record.types';

export function TranscriptRecord({
  title,
  entries,
  error,
}: TranscriptRecordProps): React.ReactNode {
  const colors = useAppMaterialColors();
  return (
    <ThemedHost matchContents={{ vertical: true }}>
      <Card
        colors={{
          containerColor: error ? colors.errorContainer : colors.surfaceContainer,
          contentColor: error ? colors.onErrorContainer : colors.onSurface,
        }}
        modifiers={[fillMaxWidth()]}
      >
        <Column verticalArrangement={{ spacedBy: 8 }} modifiers={[paddingAll(12)]}>
          <Text style={{ typography: 'labelMedium' }}>{title}</Text>
          {entries.map((entry) => (
            <Column key={entry.id} verticalArrangement={{ spacedBy: 4 }}>
              <Text style={{ typography: 'bodyMedium' }}>{entry.label}</Text>
              {entry.value ? <Text style={{ typography: 'bodyMedium' }}>{entry.value}</Text> : null}
            </Column>
          ))}
        </Column>
      </Card>
    </ThemedHost>
  );
}

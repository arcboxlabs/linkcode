import { Host, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, textSelection } from '@expo/ui/swift-ui/modifiers';
import type { TranscriptRecordProps } from './transcript-record.types';

export function TranscriptRecord({
  title,
  entries,
  error,
}: TranscriptRecordProps): React.ReactNode {
  return (
    <Host matchContents={{ vertical: true }}>
      <VStack
        alignment="leading"
        spacing={8}
        modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: 'leading' })]}
      >
        <Text
          modifiers={[
            font({ textStyle: 'caption', weight: 'semibold' }),
            error
              ? foregroundStyle('red')
              : foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          ]}
        >
          {title}
        </Text>
        {entries.map((entry) => (
          <VStack key={entry.id} alignment="leading" spacing={4}>
            <Text modifiers={[font({ textStyle: 'subheadline' }), textSelection(true)]}>
              {entry.label}
            </Text>
            {entry.value ? (
              <Text modifiers={[font({ textStyle: 'body' }), textSelection(true)]}>
                {entry.value}
              </Text>
            ) : null}
          </VStack>
        ))}
      </VStack>
    </Host>
  );
}

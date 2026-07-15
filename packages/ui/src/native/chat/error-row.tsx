import { TriangleAlert } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

export interface ErrorRowProps {
  message: string;
  code?: string;
  recoverable: boolean;
}

/** Error alert row; non-recoverable errors get the stronger danger border. */
export function ErrorRow({ message, code, recoverable }: ErrorRowProps): React.ReactNode {
  const dangerColor = String(useCSSVariable('--danger'));

  return (
    <View
      className={`flex-row items-start gap-2 rounded-xl border px-3 py-2.5 ${
        recoverable ? 'border-border' : 'border-danger/50 bg-danger/10'
      }`}
    >
      <TriangleAlert size={15} color={dangerColor} style={{ marginTop: 2 }} />
      <Text className="flex-1 text-[13px] text-foreground" style={{ lineHeight: 19 }}>
        {message}
        {code ? <Text className="text-muted"> ({code})</Text> : null}
      </Text>
    </View>
  );
}

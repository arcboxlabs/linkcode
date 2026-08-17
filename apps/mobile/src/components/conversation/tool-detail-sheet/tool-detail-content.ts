import type { ToolCall } from '@linkcode/schema';
import {
  stripAnsi,
  toolCallCommand,
  toolCallDisplayContent,
  toolCallFailureMessage,
  toolCallMetadata,
} from '@linkcode/ui/native';

/** Everything the sheet renders, derived once for both platform views. Content mirrors desktop's
 * expanded `ToolCallBody`: metadata badges, diff cards, output, failure message. */
export function toolDetailContent(toolCall: ToolCall | null): {
  metadata: ReturnType<typeof toolCallMetadata>;
  contents: ReturnType<typeof toolCallDisplayContent>;
  failure: string | undefined;
  command: string | undefined;
  rawOutput: string | undefined;
} {
  const metadata = toolCall ? toolCallMetadata(toolCall) : [];
  const contents = toolCall ? toolCallDisplayContent(toolCall) : [];
  const failure = toolCall ? toolCallFailureMessage(toolCall) : undefined;
  const command = toolCall?.kind === 'execute' ? toolCallCommand(toolCall) : undefined;
  const rawOutput =
    toolCall && contents.length === 0 && typeof toolCall.rawOutput === 'string'
      ? stripAnsi(toolCall.rawOutput)
      : undefined;
  return { metadata, contents, failure, command, rawOutput };
}

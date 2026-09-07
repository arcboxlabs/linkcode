import type { ToolCall } from '@linkcode/schema';

export interface ToolRowProps {
  title: string;
  status: ToolCall['status'];
  onPress?: () => void;
}

export interface ReasoningRowProps {
  text: string;
  streaming: boolean;
}

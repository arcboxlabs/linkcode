import type { TerminalReplayEvent } from '@linkcode/schema';

export interface TerminalRendererRef {
  events: (events: readonly TerminalReplayEvent[]) => void;
  exit: (code: number | null) => void;
}

export interface TerminalRendererProps {
  ref: React.Ref<TerminalRendererRef>;
  canControl: boolean;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady: () => void;
  onError: (message: string) => void;
}

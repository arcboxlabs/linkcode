import type { TerminalRendererRef } from '@mobile/runtime/use-terminal-session';
import type { TerminalTheme } from 'expo-libghostty';

export type { TerminalRendererRef };

export interface TerminalRendererProps {
  ref: React.Ref<TerminalRendererRef>;
  canControl: boolean;
  /** Grid font size in dp; live-reflows on Android, set before mount on iOS. */
  fontSize?: number;
  /** Terminal colors; undefined keeps ghostty's defaults. */
  theme?: TerminalTheme;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady: () => void;
  onError: (message: string) => void;
}

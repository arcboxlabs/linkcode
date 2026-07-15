import { hasToolBody, toolCallDiffStats, toolCallSummary } from '@linkcode/common/chat';
import type { ToolCall } from '@linkcode/schema';
import { Spinner } from 'heroui-native';
import { ChevronRight } from 'lucide-react-native';
import { Pressable, Text } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { useTranslations } from 'use-intl';

import { DiffCounter } from './diff-counter';
import { MONO_FONT } from './mono';
import { PulsingText } from './pulsing-text';
import { TOOL_KIND_ICONS } from './tool-icons';

export interface ToolRowProps {
  toolCall: ToolCall;
  /** Opens the tool-detail sheet; only wired when the call has a body. */
  onPress?: (toolCall: ToolCall) => void;
  /** Tightened spacing inside a consecutive tool-call run (Paseo `toolSequence`). */
  inSequence?: boolean;
}

/**
 * One-line tool row, desktop `ToolCallItem` anatomy:
 * `[kind icon] [title] [· summary] [+N −N] [›]`. Spinner while running (title pulses);
 * failure recolors text/icon `danger` — never an ✗ glyph.
 */
export function ToolRow({ toolCall, onPress, inSequence }: ToolRowProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const [mutedColor, dangerColor] = useCSSVariable(['--muted', '--danger']);
  const Icon = TOOL_KIND_ICONS[toolCall.kind];
  const running = toolCall.status === 'pending' || toolCall.status === 'in_progress';
  const failed = toolCall.status === 'failed';
  const summary = toolCallSummary(toolCall);
  const stats = toolCallDiffStats(toolCall);
  const expandable = hasToolBody(toolCall);
  const titleClass = failed ? 'text-danger' : 'text-foreground';

  return (
    <Pressable
      accessibilityRole={expandable ? 'button' : 'text'}
      accessibilityLabel={failed ? `${toolCall.title} — ${t('failed')}` : toolCall.title}
      disabled={!expandable || !onPress}
      onPress={onPress ? () => onPress(toolCall) : undefined}
      className={`min-h-9 flex-row items-center gap-2 ${inSequence ? 'py-0.5' : 'py-1'}`}
    >
      {running ? (
        <Spinner size="sm" color="default" />
      ) : (
        <Icon size={15} color={String(failed ? dangerColor : mutedColor)} />
      )}
      {running ? (
        <PulsingText className={`text-[13px] ${titleClass}`} weight="500">
          {toolCall.title}
        </PulsingText>
      ) : (
        <Text
          className={`text-[13px] ${titleClass}`}
          style={{ fontWeight: '500' }}
          numberOfLines={1}
        >
          {toolCall.title}
        </Text>
      )}
      {summary ? (
        <Text
          className="flex-1 text-[11px] text-muted"
          style={{ fontFamily: MONO_FONT }}
          numberOfLines={1}
        >
          {summary}
        </Text>
      ) : null}
      <DiffCounter additions={stats.additions} deletions={stats.deletions} />
      {expandable ? <ChevronRight size={14} color={String(mutedColor)} /> : null}
    </Pressable>
  );
}

import type { AgentKind, SessionStatus } from '@linkcode/schema';
import { Text, View } from 'react-native';

import { StatusDot } from './status-dot';

/** Mirrors the web `agent-icon.tsx` maps; brand SVGs are an M3 follow-up (initials until then). */
export const AGENT_LABELS: Record<AgentKind, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  pi: 'Pi',
};

const AGENT_INITIALS: Record<AgentKind, string> = {
  'claude-code': 'CC',
  codex: 'CX',
  opencode: 'OC',
  pi: 'PI',
};

export interface AgentIconProps {
  kind: AgentKind;
  /** Optional status dot pinned to the chip's bottom-right corner. */
  status?: SessionStatus;
  /** Translated status name for the dot's accessibility label. */
  statusLabel?: string;
  size?: 'sm' | 'md';
}

/** Quiet agent brand chip (ghost-variant equivalent of the web AgentIcon). */
export function AgentIcon({
  kind,
  status,
  statusLabel,
  size = 'sm',
}: AgentIconProps): React.ReactNode {
  const box = size === 'sm' ? 'size-7 rounded-lg' : 'size-9 rounded-xl';
  const text = size === 'sm' ? 'text-[10px]' : 'text-[11px]';
  return (
    <View
      accessibilityLabel={AGENT_LABELS[kind]}
      className={`items-center justify-center border border-border bg-surface-secondary ${box}`}
    >
      <Text className={`text-muted ${text}`} style={{ fontWeight: '600', letterSpacing: 0.5 }}>
        {AGENT_INITIALS[kind]}
      </Text>
      {status && statusLabel ? (
        <View className="-right-0.5 -bottom-0.5 absolute rounded-full border-2 border-background">
          <StatusDot status={status} label={statusLabel} />
        </View>
      ) : null}
    </View>
  );
}

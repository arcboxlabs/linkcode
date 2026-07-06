import type { AgentKind } from '@linkcode/schema';
import { AGENT_LABELS, AgentIcon } from '../../chat/agent-icon';

export interface AgentKindListProps {
  onPick: (kind: AgentKind) => void;
  /** Shown under each agent's label — e.g. "Choose a working folder" for the top-level flow. */
  hint?: string;
}

/** The agent-kind picker shared by the top "New Task" menu and a group header's "New thread" popover. */
export function AgentKindList({ onPick, hint }: AgentKindListProps): React.ReactNode {
  return (
    <div className="p-1">
      {(Object.keys(AGENT_LABELS) as AgentKind[]).map((agentKind) => (
        <button
          key={agentKind}
          type="button"
          className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onPick(agentKind)}
        >
          <AgentIcon kind={agentKind} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{AGENT_LABELS[agentKind]}</span>
            {hint && <span className="block truncate text-muted-foreground text-xs">{hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

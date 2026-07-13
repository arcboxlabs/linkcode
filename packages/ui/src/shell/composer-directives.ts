import type { AgentCommand, AgentKind } from '@linkcode/schema';

/**
 * Agents whose adapter wires a shell passthrough for the composer's `$` directive (codex
 * `thread/shellCommand`, opencode `session.shell`). Static like `AGENT_MODEL_OPTIONS`: the wire
 * has no capability channel, so this table gates the affordance and the adapter's rejecting
 * default is the enforcement.
 */
export const AGENT_SHELL_SUPPORT: Partial<Record<AgentKind, true>> = {
  codex: true,
  opencode: true,
};

/** What a submitted composer draft resolves to. */
export type ComposerDirective =
  | { kind: 'command'; name: string; arguments?: string }
  | { kind: 'shell'; command: string }
  | { kind: 'text' };

const WHITESPACE_RE = /\s/;

/**
 * Classify a submitted draft (already trimmed). `/name args` becomes a command directive only when
 * `name` is in the advertised catalog — anything else stays a plain prompt, so free-typed slash text
 * keeps today's pass-through behavior. `$ cmd` becomes a shell directive only when the agent
 * supports it (see `AGENT_SHELL_SUPPORT`); a bare `$` with nothing after it stays text.
 */
export function parseComposerDirective(
  text: string,
  opts: { commands: readonly AgentCommand[]; shellEnabled: boolean },
): ComposerDirective {
  if (opts.shellEnabled && text[0] === '$') {
    const command = text.slice(1).trim();
    if (command.length > 0) return { kind: 'shell', command };
  }
  if (text[0] === '/') {
    const body = text.slice(1);
    const nameEnd = body.search(WHITESPACE_RE);
    const name = nameEnd === -1 ? body : body.slice(0, nameEnd);
    if (name.length > 0 && opts.commands.some((command) => command.name === name)) {
      const args = nameEnd === -1 ? '' : body.slice(nameEnd + 1).trim();
      return { kind: 'command', name, arguments: args || undefined };
    }
  }
  return { kind: 'text' };
}

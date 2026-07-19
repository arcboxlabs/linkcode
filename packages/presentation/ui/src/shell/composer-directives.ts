import type { AgentCommand } from '@linkcode/schema';
import { agentCommandMatches } from '@linkcode/schema';

/** What a submitted composer draft resolves to. */
export type ComposerDirective =
  | { kind: 'command'; name: string; arguments?: string }
  | { kind: 'shell'; command: string }
  | { kind: 'text' };

const WHITESPACE_RE = /\s/;

/** Classify a submitted draft (already trimmed). `/name args` is a command directive only when
 * `name` is in the advertised catalog (canonical or alias) — anything else stays a plain prompt.
 * `$ cmd` is a shell directive only when the agent advertises it; a bare `$` stays text. */
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
    if (name.length > 0 && opts.commands.some((command) => agentCommandMatches(command, name))) {
      const args = nameEnd === -1 ? '' : body.slice(nameEnd + 1).trim();
      return { kind: 'command', name, arguments: args || undefined };
    }
  }
  return { kind: 'text' };
}

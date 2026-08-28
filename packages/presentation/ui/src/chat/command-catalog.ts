import type { AgentCommand } from '@linkcode/schema';
import { createContext, useContext } from 'react';

/** Command lookup keyed by canonical name AND every alias, so transcript chips resolve echoes
 * in O(1) during render. Provided by the conversation surface; null when no catalog exists. */
export const CommandCatalogContext = createContext<ReadonlyMap<string, AgentCommand> | null>(null);

export function buildCommandLookup(
  commands: readonly AgentCommand[],
): ReadonlyMap<string, AgentCommand> {
  const lookup = new Map<string, AgentCommand>();
  for (let i = 0, len = commands.length; i < len; i++) {
    const command = commands[i];
    for (const name of [command.name, ...(command.aliases ?? [])]) {
      if (!lookup.has(name)) lookup.set(name, command);
    }
  }
  return lookup;
}

/** The catalog entry a command name resolves to (canonical name or alias), if any. */
export function useCatalogCommand(name: string | undefined): AgentCommand | undefined {
  const lookup = useContext(CommandCatalogContext);
  if (name === undefined) return undefined;
  return lookup?.get(name);
}

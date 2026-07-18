import type { AgentCommand } from '@linkcode/schema';
import { agentCommandMatches } from '@linkcode/schema';
import type { LexicalEditor, NodeKey } from 'lexical';
import type { StoreApi } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** Validity of a directive chip against the live session's catalog/capabilities. */
export type DirectiveStatus = 'supported' | 'unknown' | 'unsupported';

/** Why structurally valid directive tokens cannot form one executable agent input. */
export type DirectivePlacementIssue = 'misplaced' | 'multiple';

export interface ComposerDirectiveState {
  /** Capability-gated slash-command catalog (empty when the agent advertises none). */
  commands: readonly AgentCommand[];
  /** Whether slash-command invocation is currently available (capability + handler) — distinguishes
   * an unknown command (catalog miss) from a composer that cannot execute commands. */
  commandsSupported: boolean;
  /** Whether shell passthrough is currently available (capability + handler present). */
  shellEnabled: boolean;
  /** Replacement TextNodes explicitly converted back to prose. Node keys keep each opt-out local. */
  suppressed: ReadonlySet<NodeKey>;
}

export type DirectiveStateStore = StoreApi<ComposerDirectiveState>;

const stores = new WeakMap<LexicalEditor, DirectiveStateStore>();

/** Per-editor directive store, created lazily so chips (decorator portals) and composer plugins
 * can rendezvous on it without any provider ordering — the editor instance is the key. */
export function directiveStateFor(editor: LexicalEditor): DirectiveStateStore {
  let store = stores.get(editor);
  if (!store) {
    store = createStore<ComposerDirectiveState>(() => ({
      commands: [],
      commandsSupported: false,
      shellEnabled: false,
      suppressed: new Set(),
    }));
    stores.set(editor, store);
  }
  return store;
}

/** Live validity of a command chip; derived (never stored on the node) so a catalog arriving
 * after the draft was typed re-labels existing chips. */
export function commandStatus(
  name: string,
  state: Pick<ComposerDirectiveState, 'commands' | 'commandsSupported'>,
): DirectiveStatus {
  if (!state.commandsSupported) return 'unsupported';
  return state.commands.some((command) => agentCommandMatches(command, name))
    ? 'supported'
    : 'unknown';
}

export function shellStatus(state: Pick<ComposerDirectiveState, 'shellEnabled'>): DirectiveStatus {
  return state.shellEnabled ? 'supported' : 'unsupported';
}

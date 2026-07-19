import type { AgentCommand } from '@linkcode/schema';
import { agentCommandMatches } from '@linkcode/schema';
import type { LexicalEditor, NodeKey } from 'lexical';
import type { StoreApi } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** Validity of a directive chip against the live session's catalog/capabilities. */
export type DirectiveStatus = 'supported' | 'unknown' | 'unsupported';

/** Why structurally valid directive tokens cannot form one executable agent input. */
export type DirectivePlacementIssue = 'misplaced' | 'multiple';

type InvokeCommand = (name: string, args?: string) => void;

/** Slash commands are either unavailable, waiting for their live catalog, or backed by an
 * authoritative catalog. Every executable state carries the handler needed to submit one. */
export type ComposerSlashCommandControls =
  | { state: 'unsupported' }
  | { state: 'loading'; onInvokeCommand: InvokeCommand }
  | {
      state: 'ready';
      commands: readonly AgentCommand[];
      onInvokeCommand: InvokeCommand;
    };

/** Shell passthrough has no catalog: the ready state only needs its required execution handler. */
export type ComposerShellCommandControls =
  | { state: 'unsupported' }
  | { state: 'ready'; onRunShellCommand: (command: string) => void };

/** Complete executable-directive contract for a composer instance. */
export interface ComposerDirectiveControls {
  slash: ComposerSlashCommandControls;
  shell: ComposerShellCommandControls;
}

export const UNSUPPORTED_COMPOSER_DIRECTIVES: ComposerDirectiveControls = {
  shell: { state: 'unsupported' },
  slash: { state: 'unsupported' },
};

const EMPTY_COMMANDS: readonly AgentCommand[] = [];

export interface ComposerDirectiveState {
  /** Live directive availability and the handlers that make executable states complete. */
  directiveControls: ComposerDirectiveControls;
  /** Mirrors the editor's disabled state for interactive decorator buttons. */
  disabled: boolean;
  /** Placement issues keyed by chip node, mirrored from the current editor analysis. */
  placementIssues: Readonly<Partial<Record<NodeKey, DirectivePlacementIssue>>>;
  /** Replacement TextNodes explicitly converted back to prose. Node keys keep each opt-out local. */
  suppressed: ReadonlySet<NodeKey>;
}

type DirectiveStateStore = StoreApi<ComposerDirectiveState>;

const stores = new WeakMap<LexicalEditor, DirectiveStateStore>();

/** Per-editor directive store, created lazily so chips (decorator portals) and composer plugins
 * can rendezvous on it without any provider ordering — the editor instance is the key. */
export function directiveStateFor(editor: LexicalEditor): DirectiveStateStore {
  let store = stores.get(editor);
  if (!store) {
    store = createStore<ComposerDirectiveState>(() => ({
      disabled: false,
      directiveControls: UNSUPPORTED_COMPOSER_DIRECTIVES,
      placementIssues: {},
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
  controls: ComposerSlashCommandControls,
): DirectiveStatus {
  if (controls.state === 'unsupported') return 'unsupported';
  if (controls.state === 'loading') return 'supported';
  return controls.commands.some((command) => agentCommandMatches(command, name))
    ? 'supported'
    : 'unknown';
}

export function commandCatalog(controls: ComposerSlashCommandControls): readonly AgentCommand[] {
  return controls.state === 'ready' ? controls.commands : EMPTY_COMMANDS;
}

export function shellStatus(controls: ComposerShellCommandControls): DirectiveStatus {
  return controls.state === 'ready' ? 'supported' : 'unsupported';
}

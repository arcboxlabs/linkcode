import type { AgentKind, SessionAutomation, SessionId } from '@linkcode/schema';
import type { TurnResult } from './turn-watcher';

export type { TurnResult } from './turn-watcher';

/**
 * The narrow session-orchestration surface the automation services (ScheduleService, and the
 * LoopService) drive agents through. SessionLifecycleService implements it with bound closures, so
 * automation never imports the lifecycle implementation — mirroring how ScriptService receives a
 * `workspaceName` lookup instead of the registry itself.
 */
export interface SessionDriver {
  /**
   * Mint a fresh live session tagged with the owning automation. The record persists and is hidden
   * from the Threads list client-side; resolves once the adapter has started.
   */
  createSession(opts: {
    kind: AgentKind;
    cwd: string;
    model?: string;
    title?: string;
    automation: SessionAutomation;
  }): Promise<SessionId>;

  /** True when a persisted record exists (live or cold). */
  hasRecord(sessionId: SessionId): boolean;

  /** True when the session is live and mid-turn — a new turn would be rejected as busy. */
  isBusy(sessionId: SessionId): boolean;

  /** Resume a cold record in place under the same id; a no-op when already live. */
  ensureLive(sessionId: SessionId): Promise<void>;

  /**
   * Best-effort switch to the most permissive approval policy so the session runs unattended.
   * Adapters without a policy axis (opencode/pi) reject it, which is swallowed — a later ask then
   * fails the run instead. Only ever applied to automation-created sessions.
   */
  makeUnattended(sessionId: SessionId): Promise<void>;

  /**
   * Send `text` as a prompt and wait for the turn to finish, returning its final assistant text.
   * Rejects on a busy session, a fatal error, a permission/question ask (unattended → the turn is
   * canceled), or a timeout.
   */
  prompt(sessionId: SessionId, text: string, opts?: { timeoutMs?: number }): Promise<TurnResult>;

  /** Stop a live session (idempotent; a no-op when cold or unknown). The record survives. */
  stopSession(sessionId: SessionId): Promise<void>;
}

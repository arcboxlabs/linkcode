import type { SessionId, SimulatorConsentDecision, SimulatorConsentState } from '@linkcode/schema';
import { RequestError } from '../failure';

/** Persistence for consent decisions; survives daemon restarts so a grant outlives the session. */
export interface SimulatorConsentStore {
  load(): Promise<SimulatorConsentState>;
  save(state: SimulatorConsentState): Promise<void>;
}

/** Volatile default so engine tests and non-daemon embeddings need no persistence. */
export class InMemorySimulatorConsentStore implements SimulatorConsentStore {
  private state: SimulatorConsentState = { entries: [], agentToolsEnabled: true };

  load(): Promise<SimulatorConsentState> {
    return Promise.resolve(this.state);
  }

  save(state: SimulatorConsentState): Promise<void> {
    this.state = state;
    return Promise.resolve();
  }
}

/** How long an agent tool waits for the user before giving up on an unanswered prompt. */
const ASK_TIMEOUT_MS = 2 * 60000;

interface PendingAsk {
  promise: Promise<SimulatorConsentDecision>;
  settle: (decision: SimulatorConsentDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Per-device consent for **agent** control of a simulator (CODE-420).
 *
 * The panel's own manual control never passes through here: the user driving a device by hand is
 * the authority this gate defers to, so a denied device stays fully usable by hand. Only the
 * daemon's simulator MCP endpoint calls {@link require}, which is what makes "agent-driven" a
 * structural property rather than a flag someone has to remember to pass.
 *
 * An unknown device suspends the tool call and asks; concurrent calls on the same device share the
 * one prompt rather than stacking dialogs. A decision persists across sessions and restarts.
 */
export class SimulatorConsentService {
  private readonly decisions = new Map<string, SimulatorConsentDecision>();
  private readonly pending = new Map<string, PendingAsk>();
  private agentToolsEnabled = true;
  private ask?: (sessionId: SessionId, udid: string, tool: string) => boolean;
  private publish?: (state: SimulatorConsentState) => void;

  constructor(
    private readonly store: SimulatorConsentStore = new InMemorySimulatorConsentStore(),
    private readonly askTimeoutMs: number = ASK_TIMEOUT_MS,
  ) {}

  /** Load persisted decisions. Failure is not fatal — an unreadable store just means "ask again". */
  async init(): Promise<void> {
    const state = await this.store.load();
    this.agentToolsEnabled = state.agentToolsEnabled;
    for (let i = 0, len = state.entries.length; i < len; i++) {
      const entry = state.entries[i];
      this.decisions.set(entry.udid, entry.decision);
    }
  }

  /**
   * Install the transport hooks. `ask` broadcasts a consent prompt and reports whether any client
   * could receive it; `publish` broadcasts state changes. The engine wires both once it owns a
   * transport — the daemon constructs this service earlier, to share it with the MCP endpoint.
   */
  setHooks(hooks: {
    ask: (sessionId: SessionId, udid: string, tool: string) => boolean;
    publish: (state: SimulatorConsentState) => void;
  }): void {
    this.ask = hooks.ask;
    this.publish = hooks.publish;
  }

  state(): SimulatorConsentState {
    return {
      entries: [...this.decisions].map(([udid, decision]) => ({ udid, decision })),
      agentToolsEnabled: this.agentToolsEnabled,
    };
  }

  /**
   * Gate an agent tool call on `udid`. Resolves when the agent may proceed; rejects with a message
   * written for the agent to read and stop, rather than retry.
   */
  async require(sessionId: SessionId, udid: string | undefined, tool: string): Promise<void> {
    if (!this.agentToolsEnabled) {
      throw new RequestError({
        code: 'forbidden',
        message:
          'simulator tools are disabled for agents in LinkCode settings; ask the user to re-enable them',
      });
    }
    // Device-less tools (listing devices) control nothing, so only the kill switch applies.
    if (udid === undefined) return;
    const decision = this.decisions.get(udid) ?? (await this.askUser(sessionId, udid, tool));
    if (decision === 'denied') {
      throw new RequestError({
        code: 'forbidden',
        message: `the user has not authorized agent control of simulator ${udid}; do not retry — ask them to grant access in the Simulator panel`,
      });
    }
  }

  /** Record a decision (or clear it back to unasked) and release anything waiting on this device. */
  async decide(udid: string, decision: SimulatorConsentDecision | undefined): Promise<void> {
    if (decision === undefined) this.decisions.delete(udid);
    else this.decisions.set(udid, decision);
    // A cleared decision leaves waiters hanging on nothing, so treat it as a denial for the calls
    // already in flight — they can be re-asked next time rather than blocked until the timeout.
    this.pending.get(udid)?.settle(decision ?? 'denied');
    await this.persist();
  }

  async setAgentToolsEnabled(enabled: boolean): Promise<void> {
    this.agentToolsEnabled = enabled;
    if (!enabled) {
      // Turning the switch off must take effect on calls already waiting, not just future ones.
      for (const ask of this.pending.values()) ask.settle('denied');
    }
    await this.persist();
  }

  /** Fail every waiter (engine shutdown); no state change, so nothing is persisted. */
  close(): void {
    for (const ask of this.pending.values()) ask.settle('denied');
  }

  private askUser(
    sessionId: SessionId,
    udid: string,
    tool: string,
  ): Promise<SimulatorConsentDecision> {
    const existing = this.pending.get(udid);
    // Concurrent tools on one device wait on the single prompt already raised for it.
    if (existing) return existing.promise;

    // With nobody attached there is no one to ask, and blocking for two minutes would just look
    // like a hang to the agent. Refuse immediately and say why.
    if (this.ask?.(sessionId, udid, tool) !== true) {
      return Promise.resolve('denied');
    }

    let settle!: (decision: SimulatorConsentDecision) => void;
    const promise = new Promise<SimulatorConsentDecision>((resolve) => {
      settle = (decision) => {
        const entry = this.pending.get(udid);
        if (entry === undefined) return;
        clearTimeout(entry.timer);
        this.pending.delete(udid);
        resolve(decision);
      };
    });
    const timer = setTimeout(() => settle('denied'), this.askTimeoutMs);
    timer.unref?.();
    this.pending.set(udid, { promise, settle, timer });
    return promise;
  }

  private async persist(): Promise<void> {
    const state = this.state();
    this.publish?.(state);
    await this.store.save(state);
  }
}

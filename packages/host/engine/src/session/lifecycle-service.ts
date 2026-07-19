import type {
  AgentHistoryId,
  AgentKind,
  SessionAutomation,
  SessionId,
  SessionRecord,
  StartOptions,
} from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import type { SessionDriver } from '../automation';
import type { WorkspaceRegistry } from '../workspace/workspace-registry';
import type { HistoryService } from './history-service';
import type { SessionOrchestrator } from './orchestrator';
import type { SessionRecordRegistry } from './session-record-registry';
import type { SessionStartOptionsResolver } from './start-options-resolver';

export class SessionLifecycleService {
  readonly driver: SessionDriver;
  private seq = 0;

  constructor(
    private readonly sessions: SessionOrchestrator,
    private readonly records: SessionRecordRegistry,
    private readonly history: HistoryService,
    private readonly startOptions: SessionStartOptionsResolver,
    private readonly workspaces: WorkspaceRegistry,
  ) {
    this.driver = {
      createSession: (options) => this.createAutomationSession(options),
      hasRecord: (sessionId) => this.records.has(sessionId),
      isBusy: (sessionId) => this.sessions.isBusy(sessionId),
      ensureLive: async (sessionId) => {
        if (this.sessions.has(sessionId)) return;
        await this.resumeSession(undefined, sessionId);
      },
      makeUnattended: (sessionId) => this.sessions.makeUnattended(sessionId),
      prompt: (sessionId, text, options) => this.sessions.prompt(sessionId, text, options),
      stopSession: (sessionId) => this.sessions.stopIfLive(sessionId),
    };
  }

  async start(replyTo: string, options: StartOptions): Promise<void> {
    const resolved = await this.startOptions.resolve(options);
    const now = Date.now();
    const record: SessionRecord = {
      sessionId: this.nextSessionId(),
      kind: resolved.kind,
      cwd: resolved.cwd,
      origin: { type: 'created' },
      createdVia: resolved.createdVia,
      createdAt: now,
      updatedAt: now,
      runs: [{ startedAt: now }],
    };
    if (resolved.cwd) await this.workspaces.touch(resolved.cwd);
    await this.sessions.startLive(replyTo, record, (adapter) => adapter.start(resolved));
  }

  async importSession(kind: AgentKind, historyId: AgentHistoryId): Promise<SessionRecord> {
    // Read one event only: the summary (title/cwd/createdAt) is what the record needs.
    const { session } = await this.history.read(kind, { historyId, limit: 1 });
    const now = Date.now();
    const record: SessionRecord = {
      sessionId: this.nextSessionId(),
      kind,
      cwd: session.cwd ?? '',
      title: session.title,
      origin: { type: 'imported', historyId, importedAt: now },
      createdAt: session.createdAt ?? now,
      updatedAt: now,
      runs: [],
    };
    await this.records.importRecord(record);
    return record;
  }

  async resumeHistory(
    replyTo: string,
    kind: AgentKind,
    historyId: AgentHistoryId,
    options: StartOptions,
  ): Promise<void> {
    const startOptions = await this.startOptions.resolve({ ...options, kind });
    const now = Date.now();
    const record: SessionRecord = {
      sessionId: this.nextSessionId(),
      kind,
      cwd: startOptions.cwd,
      origin: { type: 'imported', historyId, importedAt: now },
      createdAt: now,
      updatedAt: now,
      runs: [{ historyId, startedAt: now }],
    };
    if (startOptions.cwd) await this.workspaces.touch(startOptions.cwd);
    await this.sessions.startLive(replyTo, record, (adapter) =>
      this.history.resume(adapter, historyId, startOptions),
    );
  }

  /** Wake a cold session in place under the same LinkCode id. */
  async resumeSession(replyTo: string | undefined, sessionId: SessionId): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session is already running: ${sessionId}`);
    }
    const record = nullthrow(this.records.get(sessionId), `Unknown session: ${sessionId}`);
    // A never-prompted session has no provider transcript to resume from (the adapter only mints one
    // on the first prompt); waking it is a fresh start under the same LinkCode id.
    const historyId = this.records.historyId(sessionId);
    const startOptions = await this.startOptions.resolve({ kind: record.kind, cwd: record.cwd });
    // Register before starting so a persistence failure cannot follow a successful
    // `session.started` reply with a contradictory request failure.
    if (record.cwd) await this.workspaces.touch(record.cwd);
    record.runs.push({ historyId, startedAt: Date.now() });
    await this.sessions.startLive(replyTo, record, (adapter) =>
      historyId === undefined
        ? adapter.start(startOptions)
        : this.history.resume(adapter, historyId, startOptions),
    );
  }

  private async createAutomationSession(options: {
    kind: AgentKind;
    cwd: string;
    model?: string;
    title?: string;
    automation: SessionAutomation;
  }): Promise<SessionId> {
    const startOptions = await this.startOptions.resolve({
      kind: options.kind,
      cwd: options.cwd,
      model: options.model,
    });
    const now = Date.now();
    const record: SessionRecord = {
      sessionId: this.nextSessionId(),
      kind: startOptions.kind,
      cwd: startOptions.cwd,
      title: options.title,
      origin: { type: 'created' },
      automation: options.automation,
      createdAt: now,
      updatedAt: now,
      runs: [{ startedAt: now }],
    };
    if (startOptions.cwd) await this.workspaces.touch(startOptions.cwd);
    await this.sessions.startLive(undefined, record, (adapter) => adapter.start(startOptions));
    return record.sessionId;
  }

  private nextSessionId(): SessionId {
    this.seq += 1;
    return `sess-${Date.now().toString(36)}-${this.seq.toString(36)}` as SessionId;
  }
}

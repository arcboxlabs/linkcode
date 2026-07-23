import type {
  Accounts,
  AgentHistoryListResult,
  AgentHistoryReadResult,
  AgentRuntimes,
  AgentStartCatalog,
  FileSuggestion,
  GitDiff,
  GitPullRequestStatus,
  GitStatus,
  HostedArtifact,
  HostedFile,
  LoopInspection,
  LoopRecord,
  ManagedAssetStatus,
  ProvidersConfig,
  Schedule,
  ScheduleRun,
  SessionId,
  SessionInfo,
  SessionRecord,
  SimulatorDevice,
  SimulatorImageFormat,
  SimulatorStatus,
  SimulatorStreamCodec,
  TerminalMetadata,
  WirePayload,
  WorkspaceFile,
  WorkspaceRecord,
  WorkspaceScript,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';

interface Pending<T> {
  resolve(value: T): void;
  reject(err: Error): void;
}

export interface RequestAck {
  ok: true;
}

export type RandomUUID = () => string;

export function resolveRandomUUID(provider?: RandomUUID): RandomUUID {
  if (provider) return provider;
  const cryptoProvider = Reflect.get(globalThis, 'crypto') as
    | { randomUUID?: RandomUUID }
    | undefined;
  return nullthrow(
    cryptoProvider?.randomUUID?.bind(cryptoProvider),
    'LinkCodeClient: secure randomUUID provider unavailable',
  );
}

/**
 * The value each correlated request kind resolves with, keyed by a short tag rather than the wire
 * kind — several kinds (e.g. `session.start`/`session.resume`/`history.resume`) share one tag.
 */
export interface PendingValueMap {
  start: SessionId;
  list: SessionInfo[];
  import: SessionRecord;
  historyList: AgentHistoryListResult;
  historyRead: AgentHistoryReadResult;
  configGet: ProvidersConfig;
  accountsGet: Accounts;
  agentRuntimeList: AgentRuntimes;
  agentCatalog: AgentStartCatalog;
  assetList: ManagedAssetStatus[];
  assetEnsure: ManagedAssetStatus;
  gitStatus: GitStatus;
  gitPrStatus: GitPullRequestStatus;
  gitDiff: GitDiff;
  fileRead: WorkspaceFile;
  fileList: string[];
  fileSuggest: FileSuggestion[];
  scriptList: WorkspaceScript[];
  artifactHost: HostedArtifact;
  fileHost: HostedFile;
  workspaceList: WorkspaceRecord[];
  workspaceRegister: WorkspaceRecord;
  scheduleCreate: Schedule;
  scheduleUpdate: Schedule;
  scheduleList: Schedule[];
  scheduleRuns: ScheduleRun[];
  loopStart: LoopRecord;
  loopList: LoopRecord[];
  loopInspect: LoopInspection;
  ack: RequestAck;
  terminalOpen: string;
  terminalList: TerminalMetadata[];
  terminalAttach: { terminal: TerminalMetadata; truncated: boolean };
  agentLoginStart: string;
  simulatorStatus: SimulatorStatus;
  simulatorList: SimulatorDevice[];
  simulatorLaunch: number | null;
  simulatorScreenshot: { format: SimulatorImageFormat; data: string };
  simulatorScreenMask: string;
  simulatorStreamStart: { fps: number; scale: number; codec: SimulatorStreamCodec };
}

type PendingMaps = { [K in keyof PendingValueMap]: Map<string, Pending<PendingValueMap[K]>> };

/**
 * One pending map per correlated request kind (see {@link PendingValueMap}), keeping each kind's
 * strong result type behind a single register/resolve/reject/failAll implementation.
 */
export class PendingRegistry {
  private readonly maps: PendingMaps = {
    start: new Map(),
    list: new Map(),
    import: new Map(),
    historyList: new Map(),
    historyRead: new Map(),
    configGet: new Map(),
    accountsGet: new Map(),
    agentRuntimeList: new Map(),
    agentCatalog: new Map(),
    assetList: new Map(),
    assetEnsure: new Map(),
    gitStatus: new Map(),
    gitPrStatus: new Map(),
    gitDiff: new Map(),
    fileRead: new Map(),
    fileList: new Map(),
    fileSuggest: new Map(),
    scriptList: new Map(),
    artifactHost: new Map(),
    fileHost: new Map(),
    workspaceList: new Map(),
    workspaceRegister: new Map(),
    scheduleCreate: new Map(),
    scheduleUpdate: new Map(),
    scheduleList: new Map(),
    scheduleRuns: new Map(),
    loopStart: new Map(),
    loopList: new Map(),
    loopInspect: new Map(),
    ack: new Map(),
    terminalOpen: new Map(),
    terminalList: new Map(),
    terminalAttach: new Map(),
    agentLoginStart: new Map(),
    simulatorStatus: new Map(),
    simulatorList: new Map(),
    simulatorLaunch: new Map(),
    simulatorScreenshot: new Map(),
    simulatorScreenMask: new Map(),
    simulatorStreamStart: new Map(),
  };

  private readonly randomUUID: RandomUUID;

  constructor(randomUUID?: RandomUUID) {
    this.randomUUID = resolveRandomUUID(randomUUID);
  }

  nextClientReqId(): string {
    return `creq-${this.randomUUID()}`;
  }

  /** Register a new in-flight request and return the promise its eventual `resolve`/`reject` settles. */
  register<K extends keyof PendingValueMap>(kind: K, id: string): Promise<PendingValueMap[K]> {
    return new Promise((resolve, reject) => {
      this.maps[kind].set(id, { resolve, reject });
    });
  }

  resolve<K extends keyof PendingValueMap>(kind: K, id: string, value: PendingValueMap[K]): void {
    const pending = this.maps[kind].get(id);
    if (!pending) return;
    this.maps[kind].delete(id);
    pending.resolve(value);
  }

  /** Reject a specific kind's pending request (the request's kind is known statically at the call site). */
  rejectFrom<K extends keyof PendingValueMap>(kind: K, id: string, err: Error): void {
    const map = this.maps[kind];
    const pending = map.get(id);
    if (!pending) return;
    map.delete(id);
    pending.reject(err);
  }

  /** Reject a pending request by id alone — a `request.failed` reply doesn't carry which kind it was. */
  reject(id: string, err: Error): boolean {
    for (const map of Object.values(this.maps)) {
      const pending = map.get(id);
      if (pending) {
        map.delete(id);
        pending.reject(err);
        return true;
      }
    }
    return false;
  }

  /** Reject every in-flight request across every kind, so awaiters get an error instead of hanging forever. */
  failAll(err: Error): void {
    for (const map of Object.values(this.maps)) {
      for (const pending of map.values()) pending.reject(err);
      map.clear();
    }
  }
}

function toError(err: unknown): Error {
  return new Error(extractErrorMessage(err) ?? 'Unknown error');
}

/**
 * Send a request correlated by a fresh `clientReqId`, registered BEFORE the send so a same-tick
 * reply (local transport) can't beat the awaiter. A send failure rejects the same pending entry.
 */
export function sendCorrelated<K extends keyof PendingValueMap>(
  transport: Transport,
  pending: PendingRegistry,
  kind: K,
  makePayload: (clientReqId: string) => WirePayload,
): Promise<PendingValueMap[K]> {
  const clientReqId = pending.nextClientReqId();
  const promise = pending.register(kind, clientReqId);
  try {
    const sent = transport.send(createWireMessage(makePayload(clientReqId)));
    void Promise.resolve(sent).catch((err) => {
      pending.rejectFrom(kind, clientReqId, toError(err));
    });
  } catch (err) {
    pending.rejectFrom(kind, clientReqId, toError(err));
  }
  return promise;
}

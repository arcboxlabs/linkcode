import { noop } from 'foxts/noop';
import { configPointerPath, configSnapshotPath, decideAntiReplay, emergencyPath } from './contract';
import { applyEmergency, defaultValues, evaluateSnapshot, jsonEqual } from './evaluation';
import { cloneJson } from './i-json';
import type { EmergencyPersistentState, LoadedLkg, NormalPersistentState } from './persistence';
import {
  loadDeviceId,
  loadEmergencyState,
  loadNormalState,
  saveEmergencyState,
  saveNormalState,
} from './persistence';
import type {
  ConfigCrypto,
  ConfigDefinitions,
  ConfigEmergencyState,
  ConfigEvent,
  ConfigNetwork,
  ConfigPublicationIdentity,
  ConfigRefreshResult,
  ConfigRuntimeState,
  ConfigStorage,
  ConfigTarget,
  ConfigValue,
  ConfigValues,
  EvaluationContext,
} from './types';
import { ConfigCoreError } from './types';
import type { VerifiedPointer } from './verification';
import { validateSnapshotBytes, verifyEmergencyBytes, verifyPointerBytes } from './verification';

export interface ConfigCoreOptions<Definitions extends ConfigDefinitions> {
  readonly context: EvaluationContext;
  readonly crypto: ConfigCrypto;
  readonly definitions: Definitions;
  readonly emergencyKeyring: Readonly<Record<string, string>>;
  readonly emergencyNetwork: ConfigNetwork;
  readonly maximumSchemaVersion: number;
  readonly network: ConfigNetwork;
  readonly normalKeyring: Readonly<Record<string, string>>;
  readonly report?: (event: ConfigEvent) => void;
  readonly storage: ConfigStorage;
  readonly target: ConfigTarget;
}

type Listener<Definitions extends ConfigDefinitions> = (
  state: ConfigRuntimeState<ConfigValues<Definitions>>,
) => void;

export class ConfigCore<Definitions extends ConfigDefinitions> {
  readonly #options: ConfigCoreOptions<Definitions>;
  readonly #listeners = new Set<Listener<Definitions>>();
  #initialization: Promise<void> | null = null;
  #operationQueue = Promise.resolve();
  // Emergency refresh must stay schedulable while a normal fetch hangs: never share its queue.
  #emergencyQueue = Promise.resolve();
  #deviceId = '';
  #normal: NormalPersistentState<Definitions> = {};
  #emergency: EmergencyPersistentState = {};
  #source: ConfigRuntimeState<ConfigValues<Definitions>>['source'] = 'defaults';
  #configVersion: string | null = null;
  #sha256: string | null = null;
  #stagedColdKeys: Array<keyof ConfigValues<Definitions>> = [];
  #coldPinned: ConfigValues<Definitions>;
  #baseActive: ConfigValues<Definitions>;
  #active: ConfigValues<Definitions>;

  constructor(options: ConfigCoreOptions<Definitions>) {
    if (!Number.isSafeInteger(options.maximumSchemaVersion) || options.maximumSchemaVersion < 1) {
      throw new TypeError('maximumSchemaVersion must be a positive safe integer');
    }
    configPointerPath(options.target);
    const definitions = Object.fromEntries(
      Object.entries(options.definitions).map(([key, definition]) => [
        key,
        { defaultValue: cloneJson(definition.defaultValue), parse: definition.parse },
      ]),
    ) as Definitions;
    this.#options = {
      ...options,
      context: { ...options.context },
      definitions,
      emergencyKeyring: { ...options.emergencyKeyring },
      normalKeyring: { ...options.normalKeyring },
      target: { ...options.target },
    };
    const defaults = defaultValues(definitions);
    this.#coldPinned = defaults;
    this.#baseActive = defaults;
    this.#active = defaults;
  }

  async initialize(): Promise<ConfigRuntimeState<ConfigValues<Definitions>>> {
    if (!this.#initialization) {
      const initialization = this.#initialize();
      this.#initialization = initialization;
      void initialization.catch(() => {
        if (this.#initialization === initialization) this.#initialization = null;
      });
    }
    await this.#initialization;
    return this.getState();
  }

  async refresh(): Promise<ConfigRefreshResult> {
    try {
      await this.initialize();
    } catch (error) {
      return this.#failure('normal-refresh', error);
    }
    return this.#enqueue(() => this.#refreshNormal());
  }

  async refreshEmergency(): Promise<ConfigRefreshResult> {
    try {
      await this.initialize();
    } catch (error) {
      return this.#failure('emergency-refresh', error);
    }
    const result = this.#emergencyQueue.then(() => this.#refreshEmergency());
    this.#emergencyQueue = result.then(noop).catch(noop);
    return result;
  }

  get<Key extends keyof ConfigValues<Definitions>>(key: Key): ConfigValues<Definitions>[Key] {
    return cloneJson(this.#active[key]);
  }

  getAll(): ConfigValues<Definitions> {
    return cloneJson(this.#active as ConfigValue) as ConfigValues<Definitions>;
  }

  getState(): ConfigRuntimeState<ConfigValues<Definitions>> {
    return {
      configVersion: this.#configVersion,
      emergency: this.#emergencyView(),
      sha256: this.#sha256,
      source: this.#source,
      stagedColdKeys: [...this.#stagedColdKeys],
      values: this.getAll(),
    };
  }

  subscribe(listener: Listener<Definitions>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #initialize(): Promise<void> {
    try {
      this.#deviceId = await loadDeviceId(this.#options.storage, this.#options.crypto);
      const persistenceOptions = {
        context: this.#options.context,
        crypto: this.#options.crypto,
        definitions: this.#options.definitions,
        deviceId: this.#deviceId,
        emergencyKeyring: this.#options.emergencyKeyring,
        maximumSchemaVersion: this.#options.maximumSchemaVersion,
        normalKeyring: this.#options.normalKeyring,
        report: (event: ConfigEvent) => this.#report(event),
        storage: this.#options.storage,
        target: this.#options.target,
      };
      const [normal, emergency] = await Promise.all([
        loadNormalState(persistenceOptions),
        loadEmergencyState(persistenceOptions),
      ]);
      this.#normal = normal;
      this.#emergency = emergency;
      const values = this.#normal.lkg?.values ?? defaultValues(this.#options.definitions);
      this.#source = this.#normal.lkg ? 'lkg' : 'defaults';
      this.#configVersion = this.#normal.lkg?.pointer.document.configVersion ?? null;
      this.#sha256 = this.#normal.lkg?.pointer.document.sha256 ?? null;
      this.#coldPinned = cloneJson(values as ConfigValue) as ConfigValues<Definitions>;
      this.#baseActive = cloneJson(values as ConfigValue) as ConfigValues<Definitions>;
      this.#active = applyEmergency(
        this.#baseActive,
        this.#emergency.document?.document ?? null,
        this.#options.definitions,
      );
    } catch (error_) {
      const error = asConfigError(error_, 'storage', 'Failed to initialize configuration core');
      this.#report({ type: 'error', operation: 'initialize', error });
      throw error;
    }
  }

  async #refreshNormal(): Promise<ConfigRefreshResult> {
    let publication: ConfigPublicationIdentity | undefined;
    try {
      const response = await getResponse(
        this.#options.network,
        configPointerPath(this.#options.target),
        this.#normal.etag,
      );
      let trusted = this.#normal.trusted;
      let responseWasNotModified = false;

      if (response.status === 304) {
        responseWasNotModified = true;
        if (!trusted) throw new ConfigCoreError('fetch', 'Received 304 without a trusted pointer');
      } else {
        const body = requireBody(response.body, 'pointer');
        const candidate = await verifyPointerBytes(body, {
          crypto: this.#options.crypto,
          keyring: this.#options.normalKeyring,
          target: this.#options.target,
        });
        const antiReplay = decideAntiReplay(
          pointerReplay(candidate),
          this.#normal.highWater ?? null,
        );
        if (antiReplay === 'replay' || antiReplay === 'equivocation') {
          throw new ConfigCoreError(antiReplay, `Pointer rejected as ${antiReplay}`);
        }
        const nextState = {
          etag: response.etag,
          highWater: pointerReplay(candidate),
          lkg: this.#normal.lkg,
          trusted: candidate,
        };
        await saveNormalState(this.#options.storage, this.#options.target, nextState);
        this.#normal = nextState;
        trusted = candidate;
      }
      publication = publicationIdentity(trusted);

      const lkgRepresentsTrusted =
        this.#normal.lkg?.pointer.payloadSha256 === trusted.payloadSha256;
      if (lkgRepresentsTrusted) {
        return { status: responseWasNotModified ? 'not-modified' : 'idempotent' };
      }
      if (trusted.document.snapshotSchemaVersion > this.#options.maximumSchemaVersion) {
        throw new ConfigCoreError(
          'unsupported-schema',
          `Unsupported schemaVersion ${trusted.document.snapshotSchemaVersion}`,
        );
      }

      const snapshotResponse = await getResponse(
        this.#options.network,
        configSnapshotPath(this.#options.target, trusted.document.sha256),
      );
      if (snapshotResponse.status !== 200) {
        throw new ConfigCoreError('fetch', `Snapshot request returned ${snapshotResponse.status}`);
      }
      const snapshot = await validateSnapshotBytes(
        requireBody(snapshotResponse.body, 'snapshot'),
        trusted.document,
        this.#options.target,
        this.#options.crypto,
      );
      const values = evaluateSnapshot(
        snapshot.document,
        this.#options.definitions,
        this.#options.context,
        this.#deviceId,
        (event) => this.#report(event),
      );
      const lkg: LoadedLkg<Definitions> = { pointer: trusted, snapshot, values };
      const nextState = {
        etag: this.#normal.etag,
        highWater: this.#normal.highWater,
        lkg,
        trusted,
      };
      await saveNormalState(this.#options.storage, this.#options.target, nextState);
      this.#normal = nextState;
      this.#projectRemote(lkg);
      this.#report({ type: 'activation', publication });
      return { status: 'updated' };
    } catch (error) {
      return this.#failure('normal-refresh', error, publication);
    }
  }

  async #refreshEmergency(): Promise<ConfigRefreshResult> {
    try {
      const response = await getResponse(
        this.#options.emergencyNetwork,
        emergencyPath(this.#options.target),
        this.#emergency.etag,
      );
      if (response.status === 304) {
        if (!this.#emergency.document) {
          throw new ConfigCoreError('fetch', 'Received 304 without accepted emergency state');
        }
        return { status: 'not-modified' };
      }
      const candidate = await verifyEmergencyBytes(requireBody(response.body, 'emergency'), {
        crypto: this.#options.crypto,
        keyring: this.#options.emergencyKeyring,
        target: this.#options.target,
      });
      const decision = decideAntiReplay(
        emergencyReplay(candidate),
        this.#emergency.highWater ?? null,
      );
      if (decision === 'replay' || decision === 'equivocation') {
        throw new ConfigCoreError(decision, `Emergency document rejected as ${decision}`);
      }
      const before = this.#stateIdentity();
      const nextState = {
        document: candidate,
        etag: response.etag,
        highWater: emergencyReplay(candidate),
      };
      await saveEmergencyState(this.#options.storage, this.#options.target, nextState);
      this.#emergency = nextState;
      this.#active = applyEmergency(
        this.#baseActive,
        candidate.document,
        this.#options.definitions,
      );
      this.#emitIfChanged(before);
      return { status: decision === 'advance' ? 'updated' : 'idempotent' };
    } catch (error) {
      return this.#failure('emergency-refresh', error);
    }
  }

  #projectRemote(lkg: LoadedLkg<Definitions>): void {
    const before = this.#stateIdentity();
    const next: Record<string, ConfigValue> = {};
    const staged: Array<keyof ConfigValues<Definitions>> = [];
    for (const key of Object.keys(this.#options.definitions)) {
      const candidate = lkg.values[key];
      const pinned = this.#coldPinned[key];
      if (lkg.snapshot.document.applyModes[key] === 'hot') {
        next[key] = cloneJson(candidate);
      } else {
        next[key] = cloneJson(pinned);
        if (!jsonEqual(candidate, pinned)) staged.push(key);
      }
    }
    this.#baseActive = next as ConfigValues<Definitions>;
    this.#active = applyEmergency(
      this.#baseActive,
      this.#emergency.document?.document ?? null,
      this.#options.definitions,
    );
    this.#source = 'remote';
    this.#configVersion = lkg.pointer.document.configVersion;
    this.#sha256 = lkg.pointer.document.sha256;
    this.#stagedColdKeys = staged;
    this.#emitIfChanged(before);
  }

  #emergencyView(): ConfigEmergencyState | null {
    const emergency = this.#emergency.document?.document;
    return emergency
      ? {
          disabledFeatures: [...emergency.disabledFeatures],
          emergencyVersion: emergency.emergencyVersion,
          forceMinVersion: emergency.forceMinVersion,
          notice: emergency.notice
            ? {
                body: emergency.notice.body,
                title: emergency.notice.title,
                url: emergency.notice.url,
              }
            : null,
        }
      : null;
  }

  #failure(
    operation: 'emergency-refresh' | 'normal-refresh',
    cause: unknown,
    publication?: ConfigPublicationIdentity,
  ): { readonly status: 'error'; readonly error: ConfigCoreError } {
    const error = asConfigError(cause, 'malformed', 'Configuration operation failed');
    this.#report({ type: 'error', operation, error, ...(publication && { publication }) });
    return { status: 'error', error };
  }

  #report(event: ConfigEvent): void {
    try {
      this.#options.report?.(event);
    } catch {
      // Telemetry must not influence configuration acceptance.
    }
  }

  #stateIdentity(): string {
    return JSON.stringify(this.getState());
  }

  #emitIfChanged(before: string): void {
    if (this.#stateIdentity() === before) return;
    for (const listener of this.#listeners) {
      try {
        listener(this.getState());
      } catch {
        // Subscribers must not influence configuration acceptance.
      }
    }
  }

  #enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#operationQueue.then(operation);
    this.#operationQueue = result.then(noop).catch(noop);
    return result;
  }
}

function publicationIdentity(pointer: VerifiedPointer): ConfigPublicationIdentity {
  return {
    activationVersion: pointer.document.activationVersion,
    configVersion: pointer.document.configVersion,
    sha256: pointer.document.sha256,
  };
}

function pointerReplay(pointer: VerifiedPointer) {
  return {
    payloadSha256: pointer.payloadSha256,
    version: pointer.document.activationVersion,
  };
}

function emergencyReplay(emergency: {
  document: { emergencyVersion: string };
  payloadSha256: string;
}) {
  return {
    payloadSha256: emergency.payloadSha256,
    version: emergency.document.emergencyVersion,
  };
}

async function getResponse(network: ConfigNetwork, path: string, etag?: string) {
  try {
    const response = await network.get(path, etag ? { etag } : {});
    if (response.status !== 200 && response.status !== 304) {
      throw new ConfigCoreError('fetch', `Configuration request returned ${response.status}`);
    }
    return response;
  } catch (error) {
    if (error instanceof ConfigCoreError) throw error;
    throw new ConfigCoreError('fetch', `Configuration request failed for ${path}`, {
      cause: error,
    });
  }
}

function requireBody(body: Uint8Array | undefined, kind: string): Uint8Array {
  if (!(body instanceof Uint8Array)) {
    throw new ConfigCoreError('fetch', `${kind} response did not contain raw bytes`);
  }
  return body;
}

function asConfigError(
  cause: unknown,
  code: ConstructorParameters<typeof ConfigCoreError>[0],
  message: string,
): ConfigCoreError {
  return cause instanceof ConfigCoreError ? cause : new ConfigCoreError(code, message, { cause });
}

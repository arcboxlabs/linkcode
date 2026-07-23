import type { SessionId } from '@linkcode/schema';
import { Effect } from 'effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import { RequestError } from '../failure';
import type { SimulatorBackend, SimulatorDeviceInfo, SimulatorImageFormat } from './backend';

/** Lazily-probed host capability; mirrors the wire's `SimulatorStatus` shape structurally. */
export interface SimulatorHostStatus {
  available: boolean;
  simctlPath?: string;
  developerDir?: string;
  reason?: string;
}

/** Mirrors the reference session model: at most four simulator panes per session. */
const MAX_DEVICES_PER_SESSION = 4;
/** How long a released device we booted stays reserved before it is shut down and freed. */
const IDLE_RECLAIM_MS = 10 * 60000;

interface DeviceClaim {
  sessionId: SessionId;
  /** Devices this service booted are reclaimed (shut down) after idling; user-booted never are. */
  bootedByService: boolean;
  /** Armed when the owning session stops; a new claim within the window disarms it. */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** True once the idle timer has fired and the reclaim shutdown is in flight; a resume clears it
   * so the settling shutdown does not drop the re-acquired claim. */
  reclaiming?: boolean;
}

/**
 * The engine's simulator policy layer: device↔session ownership, per-session caps, and reclaim.
 * Every simulator operation — wire requests (CODE-394) and agent MCP tools (CODE-395) alike —
 * must route through this service; the injected {@link SimulatorBackend} is transport only, and
 * reaching around this layer would bypass ownership and consent.
 *
 * Ownership model (mirrors the reference implementation): a device belongs to the session that
 * first drives it, and concurrent sessions never share one. When the owning session stops, a
 * device this service booted idles for {@link IDLE_RECLAIM_MS} — resuming work re-claims it in
 * place — then is shut down and freed. Devices the user booted are released immediately and
 * never shut down by the engine.
 */
export class SimulatorService {
  private readonly claims = new Map<string, DeviceClaim>();
  private readonly idleReclaimMs: number;
  private readonly hasSession?: (sessionId: SessionId) => boolean;
  private probedStatus?: SimulatorHostStatus;

  constructor(
    private readonly backend: SimulatorBackend,
    opts?: { idleReclaimMs?: number; hasSession?: (sessionId: SessionId) => boolean },
  ) {
    this.idleReclaimMs = opts?.idleReclaimMs ?? IDLE_RECLAIM_MS;
    this.hasSession = opts?.hasSession;
  }

  probe(): Promise<{ simctlPath: string; developerDir: string }> {
    return this.backend.probe();
  }

  /**
   * Whether this host can drive simulators, probed lazily. A success is cached (tooling doesn't
   * un-install mid-run); a failure is re-probed on the next ask so installing Xcode heals the
   * capability without a daemon restart.
   */
  async status(): Promise<SimulatorHostStatus> {
    if (this.probedStatus) return this.probedStatus;
    try {
      const probe = await this.backend.probe();
      this.probedStatus = { available: true, ...probe };
      return this.probedStatus;
    } catch (error) {
      return { available: false, reason: extractErrorMessage(error) ?? 'probe failed' };
    }
  }

  /** Read-only; claims are not required to look. */
  list(): Promise<SimulatorDeviceInfo[]> {
    return this.backend.list();
  }

  /** Boot a device for a session, claiming it. Booting a device the user already booted claims
   * it without marking it reclaimable. */
  async boot(sessionId: SessionId, udid: string): Promise<void> {
    this.claim(sessionId, udid);
    // Distinguish "we booted it" from "it was already up": only the former is ours to shut down.
    const state = (await this.backend.list()).find((device) => device.udid === udid)?.state;
    if (state === 'Booted') return;
    try {
      await this.backend.boot(udid);
    } finally {
      // Reconcile ownership whether the boot resolved or rejected: `simctl boot` can start the
      // device even when a later bootstatus wait, the sidecar, or the reply then fails, so both
      // paths must keep it reclaimable (shutting down a device that never actually booted is a
      // harmless no-op).
      this.reconcileBootedClaim(sessionId, udid);
    }
  }

  /** After a boot attempt, mark the device service-booted so it is reclaimed. If the owning session
   * stopped mid-boot (its not-yet-service-booted claim was dropped), re-track it and arm idle
   * reclaim, exactly as if the stop had arrived after the boot. */
  private reconcileBootedClaim(sessionId: SessionId, udid: string): void {
    const claim = this.claims.get(udid);
    if (claim === undefined) {
      const reclaimed: DeviceClaim = { sessionId, bootedByService: true };
      this.claims.set(udid, reclaimed);
      this.release(udid, reclaimed);
    } else if (claim.sessionId === sessionId) {
      claim.bootedByService = true;
    }
    // else: another session claimed the device during our boot — it is theirs to manage now.
  }

  /** Shut a device down on the owner's behalf and free it. */
  async shutdownDevice(sessionId: SessionId, udid: string): Promise<void> {
    this.claim(sessionId, udid);
    await this.backend.shutdownDevice(udid);
    this.drop(udid);
  }

  // The passthroughs are `async` so a claim failure surfaces as a rejection, not a sync throw —
  // wire handlers and MCP tools treat every service call uniformly as a promise.

  async install(sessionId: SessionId, udid: string, appPath: string): Promise<void> {
    return this.withClaim(sessionId, udid, () => this.backend.install(udid, appPath));
  }

  async launch(sessionId: SessionId, udid: string, bundleId: string): Promise<number | null> {
    return this.withClaim(sessionId, udid, () => this.backend.launch(udid, bundleId));
  }

  async terminate(sessionId: SessionId, udid: string, bundleId: string): Promise<void> {
    return this.withClaim(sessionId, udid, () => this.backend.terminate(udid, bundleId));
  }

  async openUrl(sessionId: SessionId, udid: string, url: string): Promise<void> {
    return this.withClaim(sessionId, udid, () => this.backend.openUrl(udid, url));
  }

  async screenshot(
    sessionId: SessionId,
    udid: string,
    format?: SimulatorImageFormat,
  ): Promise<Uint8Array> {
    return this.withClaim(sessionId, udid, () => this.backend.screenshot(udid, format));
  }

  /** Release every device a session holds (the session-stop hook). */
  releaseSession(sessionId: SessionId): void {
    for (const [udid, claim] of this.claims) {
      if (claim.sessionId === sessionId) this.release(udid, claim);
    }
  }

  /** Which session holds a device, if any (the panel's ownership display reads this). */
  ownerOf(udid: string): SessionId | undefined {
    return this.claims.get(udid)?.sessionId;
  }

  /** Reclaim service-booted devices and release the backend (engine shutdown). */
  shutdown(): Effect.Effect<void> {
    return Effect.promise(() => this.reclaimAll()).pipe(
      Effect.andThen(Effect.sync(() => this.backend.close())),
    );
  }

  /** Run `op` under a claim on `udid`, rolling the claim back if `op` rejects AND this call is what
   * created it — a command that failed never actually acquired the device, so it must not keep
   * consuming the session's cap or block other sessions. A refreshed (pre-existing) claim is left
   * intact. Boot is the deliberate exception: it reconciles ownership itself, since a failed boot
   * may still have started the device server-side. */
  private async withClaim<T>(sessionId: SessionId, udid: string, op: () => Promise<T>): Promise<T> {
    const created = this.claim(sessionId, udid);
    try {
      return await op();
    } catch (error) {
      if (created && this.claims.get(udid)?.sessionId === sessionId) this.drop(udid);
      throw error;
    }
  }

  /**
   * Claim a device for a session, or refresh an existing claim (disarming a pending reclaim).
   * Returns whether it created a new claim (vs. refreshed an existing one). Throws `not_found` for
   * an unknown session, `conflict` when another session holds the device, and `limit_exceeded` past
   * the per-session cap.
   */
  private claim(sessionId: SessionId, udid: string): boolean {
    // Reject a stale or fabricated session before it claims a device: the engine emits no
    // session-stop for one it never started, so its claim would never be released.
    if (this.hasSession && !this.hasSession(sessionId)) {
      throw new RequestError({
        code: 'not_found',
        message: `session ${sessionId} is not active`,
      });
    }
    const existing = this.claims.get(udid);
    if (existing) {
      if (existing.sessionId !== sessionId) {
        throw new RequestError({
          code: 'conflict',
          message: `simulator ${udid} is in use by another session`,
        });
      }
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = undefined;
      }
      // Cancel an in-flight reclaim's claim-drop: the session is back, so it keeps ownership even if
      // the shutdown started (it re-boots the device on its next op).
      existing.reclaiming = false;
      return false;
    }
    let held = 0;
    for (const claim of this.claims.values()) {
      if (claim.sessionId === sessionId) held += 1;
    }
    if (held >= MAX_DEVICES_PER_SESSION) {
      throw new RequestError({
        code: 'limit_exceeded',
        message: `session already holds ${MAX_DEVICES_PER_SESSION} simulators`,
      });
    }
    this.claims.set(udid, { sessionId, bootedByService: false });
    return true;
  }

  private release(udid: string, claim: DeviceClaim): void {
    if (!claim.bootedByService) {
      this.drop(udid);
      return;
    }
    if (claim.idleTimer) clearTimeout(claim.idleTimer);
    claim.idleTimer = setTimeout(() => {
      // Shut the device down before releasing its claim: dropping first opens a window where
      // another session claims and boots the same udid while this shutdown is still in flight,
      // which would then tear down the device that session just acquired. Reclaim stays best-effort
      // (the device may already be gone — deleted in Xcode, host reboot).
      claim.reclaiming = true;
      void this.backend
        .shutdownDevice(udid)
        .catch(noop)
        .finally(() => {
          // Drop only if this is still the reclaiming claim: a resume during the shutdown clears
          // `reclaiming` (and takes ownership), so we must not drop the re-acquired claim.
          const current = this.claims.get(udid);
          if (current === claim && current.reclaiming) this.drop(udid);
        });
    }, this.idleReclaimMs);
    claim.idleTimer.unref?.();
  }

  private drop(udid: string): void {
    const claim = this.claims.get(udid);
    if (claim?.idleTimer) clearTimeout(claim.idleTimer);
    this.claims.delete(udid);
  }

  private async reclaimAll(): Promise<void> {
    const reclaim: string[] = [];
    for (const [udid, claim] of this.claims) {
      if (claim.idleTimer) clearTimeout(claim.idleTimer);
      if (claim.bootedByService) reclaim.push(udid);
    }
    this.claims.clear();
    await Promise.allSettled(reclaim.map((udid) => this.backend.shutdownDevice(udid)));
  }
}

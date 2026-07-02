import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { extractErrorMessage } from 'foxts/extract-error-message';
import {
  bindDevice,
  DEFAULT_HQ_URL,
  HqApiError,
  pollDeviceToken,
  registerDevice,
  requestBindChallenge,
  requestDeviceCode,
  signOut,
} from './api';
import { clearHqCredentials, loadHqCredentials, saveHqCredentials } from './credentials';
import type { DeviceKey } from './device-key';
import { ensureDeviceKey } from './device-key';

const log = (message: string): void => console.log(`[linkcode/daemon] ${message}`);

/**
 * `linkcode-daemon login` — RFC 8628 device sign-in for the headless daemon:
 * print a short code, let the user approve it in any signed-in browser, and
 * poll until authorized.
 *
 * Device identity is stable across re-logins: the first login registers this
 * machine as a `daemon` device (whose id becomes the tunnel host id) with the
 * public half of the machine's device key; later logins prove possession of
 * that key (challenge/bind) to re-attach the same device id, so remote
 * clients keep finding the host where they left it. Only when the proof fails
 * — device revoked, key file lost — does a fresh registration mint a new id.
 */
export async function runLoginCommand(): Promise<void> {
  const baseUrl = process.env.LINKCODE_HQ_URL || DEFAULT_HQ_URL;
  const grant = await requestDeviceCode(baseUrl);

  log(`to sign this machine in, open ${grant.verificationUriComplete}`);
  log(`(or go to ${grant.verificationUri} and enter the code: ${grant.userCode})`);

  const deadline = Date.now() + grant.expiresIn * 1000;
  let intervalMs = grant.interval * 1000;
  let sessionToken: string | null = null;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- RFC 8628 polling is inherently sequential
    await sleep(intervalMs);
    // eslint-disable-next-line no-await-in-loop -- RFC 8628 polling is inherently sequential
    const poll = await pollDeviceToken(baseUrl, grant.deviceCode);
    if (poll.status === 'authorized') {
      sessionToken = poll.sessionToken;
      break;
    }
    if (poll.status === 'slow-down') intervalMs += 5000;
    else if (poll.status === 'rejected') {
      throw new HqApiError(
        `sign-in was ${poll.reason === 'access_denied' ? 'denied' : `rejected: ${poll.reason}`}`,
      );
    }
  }
  if (!sessionToken) throw new HqApiError('sign-in timed out — run login again');

  const key = ensureDeviceKey();
  let deviceId = await tryRebind(baseUrl, sessionToken, key);
  if (deviceId) {
    log(`signed in to ${baseUrl}; kept device identity ${deviceId}`);
  } else {
    ({ deviceId } = await registerDevice(baseUrl, sessionToken, {
      kind: 'daemon',
      name: hostname(),
      platform: `${process.platform}-${process.arch}`,
      publicKey: key.publicKeyPem,
      keyProtection: 'software',
    }));
    log(`signed in to ${baseUrl}; registered as device ${deviceId}`);
  }
  saveHqCredentials({ baseUrl, sessionToken, deviceId });
  log('restart the daemon to bring the remote-access uplink online');
}

/**
 * Re-attach a previously registered device id by proving possession of its
 * key. Null (rather than a throw) hands unrecoverable cases — no prior
 * sign-in, device revoked, key lost — to fresh registration.
 */
async function tryRebind(
  baseUrl: string,
  sessionToken: string,
  key: DeviceKey,
): Promise<string | null> {
  const prior = loadHqCredentials();
  if (prior?.baseUrl !== baseUrl) return null;
  try {
    const challenge = await requestBindChallenge(baseUrl, sessionToken, prior.deviceId);
    await bindDevice(baseUrl, sessionToken, prior.deviceId, {
      challenge,
      signature: key.sign(challenge),
    });
    return prior.deviceId;
  } catch (err) {
    log(
      `could not re-bind device ${prior.deviceId} (${extractErrorMessage(err)}); registering a fresh device`,
    );
    return null;
  }
}

/** `linkcode-daemon logout` — revoke the HQ session and clear local state. */
export async function runLogoutCommand(): Promise<void> {
  const credentials = loadHqCredentials();
  if (!credentials) {
    log('not signed in');
    return;
  }
  try {
    await signOut(credentials.baseUrl, credentials.sessionToken);
  } catch (err) {
    // The local credential must go regardless; the server session still
    // expires on its own schedule.
    log(`sign-out request failed (${extractErrorMessage(err)}); clearing local credentials anyway`);
  }
  clearHqCredentials();
  log('signed out');
}

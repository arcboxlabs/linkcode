import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { extractErrorMessage } from 'foxts/extract-error-message';
import {
  DEFAULT_HQ_URL,
  HqApiError,
  pollDeviceToken,
  registerDevice,
  requestDeviceCode,
  signOut,
} from './api';
import { clearHqCredentials, loadHqCredentials, saveHqCredentials } from './credentials';

const log = (message: string): void => console.log(`[linkcode/daemon] ${message}`);

/**
 * `linkcode-daemon login` — RFC 8628 device sign-in for the headless daemon:
 * print a short code, let the user approve it in any signed-in browser, poll
 * until authorized, then register this machine as a `daemon` device (whose id
 * becomes the tunnel host id) and persist the credentials.
 *
 * Signing in again registers a fresh device (a new session cannot prove it
 * owns the old device id yet — that needs the device-key work), so remote
 * clients re-discover the host under its new id; revoke stale devices from a
 * signed-in client.
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

  const { deviceId } = await registerDevice(baseUrl, sessionToken, {
    kind: 'daemon',
    name: hostname(),
    platform: `${process.platform}-${process.arch}`,
  });
  saveHqCredentials({ baseUrl, sessionToken, deviceId });
  log(`signed in to ${baseUrl}; registered as device ${deviceId}`);
  log('restart the daemon to bring the remote-access uplink online');
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

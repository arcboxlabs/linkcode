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
import { ensureDeviceKey } from './device-key';

const log = (message: string): void => console.log(`[linkcode/daemon] ${message}`);

/**
 * `linkcode-daemon login` — RFC 8628 device sign-in: print a short code, let the user approve it
 * in a signed-in browser, poll until authorized. Registration proves key possession (`keyProof`)
 * and the server keeps one device per key, so every login — including under a different account —
 * resolves to the same device id; only a lost key mints a new identity.
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
  const { deviceId } = await registerDevice(baseUrl, sessionToken, {
    kind: 'daemon',
    name: hostname(),
    platform: `${process.platform}-${process.arch}`,
    publicKey: key.publicKeyPem,
    // Possession proof: sign the very credential this request presents.
    keyProof: key.sign(sessionToken),
    keyProtection: key.protection,
  });
  log(`signed in to ${baseUrl}; device ${deviceId} (${key.protection} key)`);
  saveHqCredentials({ baseUrl, sessionToken, deviceId });
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

import { extractErrorMessage } from 'foxts/extract-error-message';

/**
 * The daemon's REST surface of LinkCode HQ (the linkcodehq backend): the
 * RFC 8628 device flow it signs in with, the device registry, and the
 * tunnel-JWT exchange. Responses are validated at this boundary; callers
 * downstream trust the returned shapes.
 */

/** Default HQ origin; `LINKCODE_HQ_URL` overrides it at login time. */
export const DEFAULT_HQ_URL = 'https://api.linkcode.ai';

/** The client_id HQ whitelists for the daemon's device flow (validateClient). */
export const DEVICE_FLOW_CLIENT_ID = 'linkcode-daemon';

export class HqApiError extends Error {
  override name = 'HqApiError';
}

function hqError(message: string, status: number): HqApiError {
  return new HqApiError(`${message} (HTTP ${status})`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function hqJson(
  baseUrl: string,
  path: string,
  init: { method?: string; body?: unknown; sessionToken?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.sessionToken) headers.authorization = `Bearer ${init.sessionToken}`;
  let res: Response;
  try {
    res = await fetch(new URL(path, baseUrl), {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    throw new HqApiError(`HQ unreachable at ${baseUrl}: ${extractErrorMessage(err)}`);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body (e.g. an HTML error page); callers act on the status.
  }
  return { status: res.status, body };
}

export interface DeviceCodeGrant {
  deviceCode: string;
  userCode: string;
  /** Absolute URL of the approval page. */
  verificationUri: string;
  /** Approval page with the user code pre-filled. */
  verificationUriComplete: string;
  /** Minimum seconds between polls. */
  interval: number;
  /** Seconds until the grant expires. */
  expiresIn: number;
}

export async function requestDeviceCode(baseUrl: string): Promise<DeviceCodeGrant> {
  const { status, body } = await hqJson(baseUrl, '/auth/device/code', {
    body: { client_id: DEVICE_FLOW_CLIENT_ID },
  });
  if (
    status !== 200 ||
    !isRecord(body) ||
    typeof body.device_code !== 'string' ||
    typeof body.user_code !== 'string' ||
    typeof body.verification_uri !== 'string' ||
    typeof body.verification_uri_complete !== 'string'
  ) {
    throw hqError('device sign-in could not start', status);
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    // better-auth may return the approval page as a relative path.
    verificationUri: new URL(body.verification_uri, baseUrl).href,
    verificationUriComplete: new URL(body.verification_uri_complete, baseUrl).href,
    interval: typeof body.interval === 'number' ? body.interval : 5,
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 1800,
  };
}

export type DeviceTokenPoll =
  | { status: 'authorized'; sessionToken: string }
  | { status: 'pending' }
  /** RFC 8628 §3.5: back off by 5s before polling again. */
  | { status: 'slow-down' }
  | { status: 'rejected'; reason: string };

export async function pollDeviceToken(
  baseUrl: string,
  deviceCode: string,
): Promise<DeviceTokenPoll> {
  const { status, body } = await hqJson(baseUrl, '/auth/device/token', {
    body: {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: DEVICE_FLOW_CLIENT_ID,
    },
  });
  if (isRecord(body) && typeof body.access_token === 'string') {
    return { status: 'authorized', sessionToken: body.access_token };
  }
  const reason = isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${status}`;
  if (reason === 'authorization_pending') return { status: 'pending' };
  if (reason === 'slow_down') return { status: 'slow-down' };
  return { status: 'rejected', reason };
}

/** Exchange the stored session for a short-lived tunnel JWT (`GET /auth/token`). */
export async function fetchTunnelToken(baseUrl: string, sessionToken: string): Promise<string> {
  const { status, body } = await hqJson(baseUrl, '/auth/token', { sessionToken });
  if (status === 200 && isRecord(body) && typeof body.token === 'string') return body.token;
  throw hqError('tunnel token refresh failed — signed out or device revoked?', status);
}

/**
 * Register this installation as a device. HQ binds the session to the new
 * device, which stamps the `device_id` claim into subsequent tunnel JWTs;
 * the returned id is the daemon's tunnel host id.
 */
export async function registerDevice(
  baseUrl: string,
  sessionToken: string,
  device: { kind: 'daemon'; name: string; platform?: string },
): Promise<{ deviceId: string }> {
  const { status, body } = await hqJson(baseUrl, '/devices', { body: device, sessionToken });
  if (status === 200 && isRecord(body) && typeof body.id === 'string') {
    return { deviceId: body.id };
  }
  throw hqError('device registration failed', status);
}

export async function signOut(baseUrl: string, sessionToken: string): Promise<void> {
  const { status } = await hqJson(baseUrl, '/auth/sign-out', { body: {}, sessionToken });
  if (status !== 200) throw hqError('sign-out failed', status);
}

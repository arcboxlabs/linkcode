import { extractErrorMessage } from 'foxts/extract-error-message';
import fetch from 'make-fetch-happen';
import '../mfh-augment';
import { DownloadError } from '../errors';
import { getDarwinSystemProxy } from './darwin';
import type { SystemProxyDetection } from './types';
import { getWin32SystemProxy } from './win32';

/**
 * make-fetch-happen's per-request proxy options (consumed by @npmcli/agent, where an explicit
 * `proxy` overrides the `*_PROXY` env vars and an explicit `noProxy` overrides `NO_PROXY`).
 */
export interface SystemProxyOptions {
  proxy: string;
  noProxy: string[];
}

/** The env vars @npmcli/agent reads (case-insensitively) to pick a proxy on its own. */
const PROXY_ENV_KEYS = new Set(['https_proxy', 'http_proxy', 'proxy']);

/**
 * Fetch through the OS-configured proxy when the environment names none. GUI-launched desktop
 * apps (Dock / Start menu) inherit no `*_PROXY` env vars — the system proxy lives in OS settings,
 * which the platform legs read (win32 WinINET registry via `reg.exe`, darwin `scutil`; elsewhere
 * the env vars are the only proxy source and make-fetch-happen already honors them). When the
 * request fails through a system proxy, the error names the proxy so "proxy unreachable" is
 * distinguishable from "source unreachable". Resolution is per call — a settings change applies
 * to the next request, and the cost (one `reg.exe`/`scutil` spawn) is noise next to the transfer
 * itself. Detection failures and unsupported PAC configurations fail explicitly rather than
 * bypassing the configured proxy.
 */
export async function fetchWithSystemProxy(
  url: string,
  options: fetch.FetchOptions,
): ReturnType<typeof fetch> {
  const systemProxy = await resolveSystemProxy();
  try {
    return await fetch(url, { ...options, ...systemProxy });
  } catch (error) {
    if (!systemProxy) throw error;
    throw new DownloadError(
      `${extractErrorMessage(error, false)} (via system proxy ${systemProxy.proxy})`,
      { cause: error },
    );
  }
}

export async function resolveSystemProxy(): Promise<SystemProxyOptions | undefined> {
  // The env is the operator's word: when it names a proxy, make-fetch-happen already honors it
  // (and its absence of NO_PROXY too) — never second-guess it with the OS configuration.
  if (envNamesProxy()) return undefined;
  const detected = await detectSystemProxy();
  if (!detected) return undefined;
  // A PAC URL names a script, not a proxy endpoint; @npmcli/agent cannot dial it directly.
  if (detected.kind === 'pac') {
    throw new DownloadError(`PAC system proxy configuration is unsupported: ${detected.pacUrl}`);
  }
  return { proxy: detected.proxyUrl, noProxy: mergeEnvNoProxy(detected.noProxy) };
}

async function detectSystemProxy(): Promise<SystemProxyDetection | undefined> {
  try {
    if (process.platform === 'win32') return getWin32SystemProxy();
    if (process.platform === 'darwin') return await getDarwinSystemProxy();
    return undefined;
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    throw new DownloadError(
      `failed to read OS proxy configuration: ${extractErrorMessage(error, false)}`,
      { cause: error },
    );
  }
}

function envNamesProxy(): boolean {
  return Object.entries(process.env).some(
    ([key, value]) => PROXY_ENV_KEYS.has(key.toLowerCase()) && !!value,
  );
}

/** Passing `noProxy` makes @npmcli/agent ignore the NO_PROXY env var — merge it back in. */
function mergeEnvNoProxy(osNoProxy: string[]): string[] {
  const env = Object.entries(process.env).find(
    ([key, value]) => key.toLowerCase() === 'no_proxy' && !!value,
  )?.[1];
  const envNoProxy: string[] = [];
  for (const host of env?.split(',') ?? []) {
    const trimmed = host.trim();
    if (trimmed) envNoProxy.push(trimmed);
  }
  return [...new Set([...osNoProxy, ...envNoProxy])];
}

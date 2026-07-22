/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { DownloadError } from '../errors';
import type { SystemProxyDetection } from './types';

/**
 * WinINET system-proxy detection: read the Internet Settings registry key with `reg.exe`
 * (System32 — the same guarantee extract.ts relies on for `tar.exe`) and interpret
 * `AutoConfigURL` / `ProxyEnable` / `ProxyServer` / `ProxyOverride`. The interpretation is
 * adapted from httptoolkit/windows-system-proxy (Apache-2.0); the registry read replaces its
 * native `registry-js` addon, whose win32-only prebuilds would force a node-gyp toolchain on
 * every mac/linux install.
 */

const INTERNET_SETTINGS = String.raw`HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings`;

/** A `reg.exe query` value row: 4-space indent, then name / REG_* type / data, 4-space separated. */
const VALUE_ROW = /^ {4}(.+?) {4}(REG_[A-Z_]+) {4}(.*)$/;

export function getWin32SystemProxy(): SystemProxyDetection | undefined {
  const regExe = join(process.env.SystemRoot ?? String.raw`C:\Windows`, 'System32', 'reg.exe');
  const output = execFileSync(regExe, ['query', INTERNET_SETTINGS], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return interpretInternetSettings(parseRegQueryOutput(output));
}

/**
 * Parse `reg.exe query` output into name → data (`REG_SZ`/`REG_EXPAND_SZ` as string, `REG_DWORD`
 * as number — the same three types `registry-js` materializes). Exported for tests.
 */
export function parseRegQueryOutput(output: string): Map<string, string | number> {
  const values = new Map<string, string | number>();
  for (const line of output.split(/\r?\n/)) {
    const row = VALUE_ROW.exec(line);
    if (!row) continue;
    const [, name, type, data] = row;
    if (type === 'REG_SZ' || type === 'REG_EXPAND_SZ') {
      values.set(name, data);
    } else if (type === 'REG_DWORD') {
      values.set(name, Number.parseInt(data, 16));
    }
  }
  return values;
}

/** Exported for tests. */
export function interpretInternetSettings(
  values: ReadonlyMap<string, string | number>,
): SystemProxyDetection | undefined {
  // A configured setup script wins over manual settings, matching WinINET's own precedence.
  const autoConfigUrl = values.get('AutoConfigURL');
  if (typeof autoConfigUrl === 'string' && autoConfigUrl) {
    return { kind: 'pac', pacUrl: autoConfigUrl };
  }
  const proxyServer = values.get('ProxyServer');
  if (!proxyServer || typeof proxyServer !== 'string' || !values.get('ProxyEnable')) {
    return undefined;
  }
  return {
    kind: 'proxy',
    proxyUrl: parseProxyServer(proxyServer),
    noProxy: parseProxyOverride(values.get('ProxyOverride')),
  };
}

/**
 * `ProxyServer` comes in three shapes: a full URL, `protocol=host:port` pairs separated by `;`
 * (per-protocol configuration), or a bare `host:port`. For the pair form, prefer http, then
 * socks, then https — proxies listed under one protocol overwhelmingly serve the others too.
 */
function parseProxyServer(config: string): string {
  if (config.startsWith('http://') || config.startsWith('https://')) return config;
  if (config.includes('=')) {
    const byProtocol = new Map(
      config.split(';').map((pair) => pair.split('=', 2) as [string, string]),
    );
    const http = byProtocol.get('http');
    if (http) return `http://${http}`;
    const socks = byProtocol.get('socks');
    if (socks) return `socks://${socks}`;
    const https = byProtocol.get('https');
    if (https) return `http://${https}`;
    throw new DownloadError(`no usable proxy in ProxyServer value: ${config}`);
  }
  return `http://${config}`;
}

/** `ProxyOverride` is `;`-separated bypass hosts; `<local>` means "no dots in the hostname". */
function parseProxyOverride(override: string | number | undefined): string[] {
  if (typeof override !== 'string') return [];
  const noProxy: string[] = [];
  for (const entry of override.split(';')) {
    const host = entry.trim();
    if (!host) continue;
    if (host === '<local>') noProxy.push('localhost', '127.0.0.1', '::1');
    else noProxy.push(host);
  }
  return noProxy;
}

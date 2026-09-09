export interface NativeDiscoveredDaemon {
  id: string;
  name: string;
  host: string;
  port: number;
}

export interface DiscoveredDaemon {
  id: string;
  name: string;
  url: string;
}

const rTrailingDot = /\.$/g;
const rUnescapedScope = /%(?!25)/g;
const rTrailingSlash = /\/$/g;

function unbracketHost(host: string): string {
  return host[0] === '[' && host.at(-1) === ']' ? host.slice(1, -1) : host;
}

export function formatDiscoveryUrl(host: string, port: number): string | undefined {
  const normalizedHost = unbracketHost(host.trim().replaceAll(rTrailingDot, ''));
  const urlHost = normalizedHost.includes(':')
    ? `[${normalizedHost.replaceAll(rUnescapedScope, '%25')}]`
    : normalizedHost;
  const url = `http://${urlHost}:${port}`;
  try {
    return new URL(url).hostname ? url : undefined;
  } catch {
    return undefined;
  }
}

export function toDiscoveredDaemon(host: NativeDiscoveredDaemon): DiscoveredDaemon | undefined {
  const url = formatDiscoveryUrl(host.host, host.port);
  if (!url) return undefined;
  return {
    id: host.id,
    name: host.name,
    url,
  };
}

export function canonicalDirectHostUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const serialized = parsed.href;
    return parsed.pathname === '/' && !parsed.search
      ? serialized.replaceAll(rTrailingSlash, '')
      : serialized;
  } catch {
    return url;
  }
}

import type { MacProxySettings } from 'mac-system-proxy';
import { getMacSystemProxy } from 'mac-system-proxy';
import type { SystemProxyDetection } from './types';

/**
 * macOS system-proxy detection over `mac-system-proxy` (`scutil --proxy`; pure JS). The mapping
 * is adapted from httptoolkit/os-proxy-config (Apache-2.0) with two fixes: enable flags compare
 * to `'1'` — scutil reports `'0'` for a disabled proxy whose host/port linger, and a bare
 * truthiness check would treat it as enabled — and a PAC configuration is surfaced instead of
 * silently ignored.
 */

export async function getDarwinSystemProxy(): Promise<SystemProxyDetection | undefined> {
  return mapMacProxySettings(await getMacSystemProxy());
}

/** Exported for tests. */
export function mapMacProxySettings(settings: MacProxySettings): SystemProxyDetection | undefined {
  if (settings.ProxyAutoConfigEnable === '1' && settings.ProxyAutoConfigURLString) {
    return { kind: 'pac', pacUrl: settings.ProxyAutoConfigURLString };
  }
  const noProxy = settings.ExceptionsList ?? [];
  if (settings.HTTPEnable === '1' && settings.HTTPProxy && settings.HTTPPort) {
    return {
      kind: 'proxy',
      proxyUrl: `http://${settings.HTTPProxy}:${settings.HTTPPort}`,
      noProxy,
    };
  }
  if (settings.SOCKSEnable === '1' && settings.SOCKSProxy && settings.SOCKSPort) {
    return {
      kind: 'proxy',
      proxyUrl: `socks://${settings.SOCKSProxy}:${settings.SOCKSPort}`,
      noProxy,
    };
  }
  if (settings.HTTPSEnable === '1' && settings.HTTPSProxy && settings.HTTPSPort) {
    return {
      kind: 'proxy',
      proxyUrl: `http://${settings.HTTPSProxy}:${settings.HTTPSPort}`,
      noProxy,
    };
  }
  return undefined;
}

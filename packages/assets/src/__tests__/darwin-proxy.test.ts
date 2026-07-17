import { describe, expect, it } from 'vitest';
import { mapMacProxySettings } from '../system-proxy/darwin';

describe('mapMacProxySettings', () => {
  it('maps an enabled HTTP proxy with its exceptions list', () => {
    expect(
      mapMacProxySettings({
        HTTPEnable: '1',
        HTTPProxy: '127.0.0.1',
        HTTPPort: '7890',
        ExceptionsList: ['*.local', '169.254/16'],
      }),
    ).toEqual({
      kind: 'proxy',
      proxyUrl: 'http://127.0.0.1:7890',
      noProxy: ['*.local', '169.254/16'],
    });
  });

  it("treats a '0' enable flag as disabled even when host and port linger", () => {
    expect(
      mapMacProxySettings({ HTTPEnable: '0', HTTPProxy: '127.0.0.1', HTTPPort: '7890' }),
    ).toBeUndefined();
  });

  it('prefers http over socks over https', () => {
    const socksAndHttps = {
      SOCKSEnable: '1',
      SOCKSProxy: 'socks.test',
      SOCKSPort: '1080',
      HTTPSEnable: '1',
      HTTPSProxy: 'https.test',
      HTTPSPort: '8443',
    } as const;
    expect(
      mapMacProxySettings({
        HTTPEnable: '1',
        HTTPProxy: 'http.test',
        HTTPPort: '8080',
        ...socksAndHttps,
      }),
    ).toMatchObject({ proxyUrl: 'http://http.test:8080' });
    expect(mapMacProxySettings(socksAndHttps)).toMatchObject({
      proxyUrl: 'socks://socks.test:1080',
    });
    expect(
      mapMacProxySettings({ HTTPSEnable: '1', HTTPSProxy: 'https.test', HTTPSPort: '8443' }),
    ).toMatchObject({ proxyUrl: 'http://https.test:8443' });
  });

  it('reports an enabled PAC configuration over manual settings', () => {
    expect(
      mapMacProxySettings({
        ProxyAutoConfigEnable: '1',
        ProxyAutoConfigURLString: 'http://pac.test/proxy.pac',
        HTTPEnable: '1',
        HTTPProxy: '127.0.0.1',
        HTTPPort: '7890',
      }),
    ).toEqual({ kind: 'pac', pacUrl: 'http://pac.test/proxy.pac' });
  });

  it('ignores a PAC flag without a script URL and empty settings', () => {
    expect(mapMacProxySettings({ ProxyAutoConfigEnable: '1' })).toBeUndefined();
    expect(mapMacProxySettings({})).toBeUndefined();
  });
});

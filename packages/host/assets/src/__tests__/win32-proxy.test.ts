import { describe, expect, it } from 'vitest';
import { DownloadError } from '../errors';
import { interpretInternetSettings, parseRegQueryOutput } from '../system-proxy/win32';

/** Verbatim shape of `reg query "HKCU\...\Internet Settings"` on Windows 10/11. */
const TYPICAL_OUTPUT = [
  '',
  String.raw`HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings`,
  '    CertificateRevocation    REG_DWORD    0x1',
  '    ProxyEnable    REG_DWORD    0x1',
  '    ProxyServer    REG_SZ    127.0.0.1:7890',
  '    ProxyOverride    REG_SZ    <local>;*.internal.test',
  '    User Agent    REG_SZ    Mozilla/4.0 (compatible; MSIE 8.0; Win32)',
  '    LockDatabase    REG_QWORD    0x1dca9548a439845',
  '',
  String.raw`HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings\5.0`,
  String.raw`HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings\Cache`,
  '',
].join('\r\n');

describe('parseRegQueryOutput', () => {
  it('collects string and dword values, keeping names with spaces', () => {
    expect(parseRegQueryOutput(TYPICAL_OUTPUT)).toEqual(
      new Map<string, string | number>([
        ['CertificateRevocation', 1],
        ['ProxyEnable', 1],
        ['ProxyServer', '127.0.0.1:7890'],
        ['ProxyOverride', '<local>;*.internal.test'],
        ['User Agent', 'Mozilla/4.0 (compatible; MSIE 8.0; Win32)'],
      ]),
    );
  });

  it('skips value types registry readers do not materialize', () => {
    const output = [
      '    ConnectionsBlob    REG_BINARY    3C00000004000000',
      String.raw`    SomePath    REG_EXPAND_SZ    %SystemRoot%\system32`,
    ].join('\r\n');
    expect(parseRegQueryOutput(output)).toEqual(
      new Map([['SomePath', String.raw`%SystemRoot%\system32`]]),
    );
  });

  it('returns an empty map for a value-less key', () => {
    expect(parseRegQueryOutput('\r\nHKEY_CURRENT_USER\\Software\r\n\r\n')).toEqual(new Map());
  });
});

const values = (entries: Record<string, string | number>) => new Map(Object.entries(entries));

describe('interpretInternetSettings', () => {
  it('maps an enabled manual proxy, expanding <local> in the bypass list', () => {
    expect(interpretInternetSettings(parseRegQueryOutput(TYPICAL_OUTPUT))).toEqual({
      kind: 'proxy',
      proxyUrl: 'http://127.0.0.1:7890',
      noProxy: ['localhost', '127.0.0.1', '::1', '*.internal.test'],
    });
  });

  it('returns undefined when the proxy is disabled or has no server', () => {
    expect(
      interpretInternetSettings(values({ ProxyEnable: 0, ProxyServer: '127.0.0.1:7890' })),
    ).toBeUndefined();
    expect(interpretInternetSettings(values({ ProxyEnable: 1 }))).toBeUndefined();
    expect(interpretInternetSettings(values({ ProxyEnable: 1, ProxyServer: '' }))).toBeUndefined();
  });

  it('keeps a full-URL ProxyServer as-is', () => {
    expect(
      interpretInternetSettings(values({ ProxyEnable: 1, ProxyServer: 'http://proxy.corp:8080' })),
    ).toEqual({ kind: 'proxy', proxyUrl: 'http://proxy.corp:8080', noProxy: [] });
  });

  it('prefers http, then socks, then https from per-protocol pairs', () => {
    const detect = (proxyServer: string) =>
      interpretInternetSettings(values({ ProxyEnable: 1, ProxyServer: proxyServer }));
    expect(detect('ftp=f:21;http=h:1;socks=k:3')).toMatchObject({ proxyUrl: 'http://h:1' });
    expect(detect('socks=k:3;https=s:2')).toMatchObject({ proxyUrl: 'socks://k:3' });
    expect(detect('https=s:2')).toMatchObject({ proxyUrl: 'http://s:2' });
    expect(() => detect('ftp=f:21')).toThrow(DownloadError);
  });

  it('reports a configured setup script as PAC, over any manual settings', () => {
    expect(
      interpretInternetSettings(
        values({
          AutoConfigURL: 'http://pac.corp/proxy.pac',
          ProxyEnable: 1,
          ProxyServer: '127.0.0.1:7890',
        }),
      ),
    ).toEqual({ kind: 'pac', pacUrl: 'http://pac.corp/proxy.pac' });
  });
});

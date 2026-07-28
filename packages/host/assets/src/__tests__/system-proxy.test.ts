import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadError } from '../errors';
import { fetchWithSystemProxy, resolveSystemProxy } from '../system-proxy';

const { fetchMock, win32Mock, darwinMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  win32Mock: vi.fn(),
  darwinMock: vi.fn(),
}));

vi.mock('make-fetch-happen', () => ({ default: fetchMock }));
vi.mock('../system-proxy/win32', () => ({ getWin32SystemProxy: win32Mock }));
vi.mock('../system-proxy/darwin', () => ({ getDarwinSystemProxy: darwinMock }));

const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'PROXY',
  'proxy',
  'NO_PROXY',
  'no_proxy',
];

const originalProxyEnv = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  fetchMock.mockReset();
  win32Mock.mockReset();
  darwinMock.mockReset();
  for (const key of PROXY_ENV_KEYS) delete process.env[key];
  setPlatform('win32');
});

afterEach(() => {
  setPlatform(originalPlatform);
});

afterAll(() => {
  for (const key of PROXY_ENV_KEYS) {
    const value = originalProxyEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('resolveSystemProxy', () => {
  it('leaves explicit proxy environment variables to make-fetch-happen', async () => {
    process.env.HTTPS_PROXY = 'http://env-proxy.test:8080';

    await expect(resolveSystemProxy()).resolves.toBeUndefined();
    expect(win32Mock).not.toHaveBeenCalled();
  });

  it('returns the OS proxy and merges environment bypass entries', async () => {
    process.env.NO_PROXY = 'env.test, shared.test, ,';
    win32Mock.mockReturnValue({
      kind: 'proxy',
      proxyUrl: 'http://system-proxy.test:8080',
      noProxy: ['os.test', 'shared.test'],
    });

    await expect(resolveSystemProxy()).resolves.toEqual({
      proxy: 'http://system-proxy.test:8080',
      noProxy: ['os.test', 'shared.test', 'env.test'],
    });
  });

  it('consults the darwin leg on darwin and nothing elsewhere', async () => {
    setPlatform('darwin');
    darwinMock.mockResolvedValue(undefined);
    await expect(resolveSystemProxy()).resolves.toBeUndefined();
    expect(darwinMock).toHaveBeenCalledOnce();
    expect(win32Mock).not.toHaveBeenCalled();

    setPlatform('linux');
    await expect(resolveSystemProxy()).resolves.toBeUndefined();
    expect(darwinMock).toHaveBeenCalledOnce();
    expect(win32Mock).not.toHaveBeenCalled();
  });

  it('fails with context when OS proxy detection fails', async () => {
    const cause = new Error('reg.exe exited with 1');
    win32Mock.mockImplementation(() => {
      throw cause;
    });

    await expect(resolveSystemProxy()).rejects.toMatchObject({
      name: 'DownloadError',
      message: 'failed to read OS proxy configuration: reg.exe exited with 1',
      cause,
    });
  });

  it('propagates a leg DownloadError without re-wrapping', async () => {
    win32Mock.mockImplementation(() => {
      throw new DownloadError('no usable proxy in ProxyServer value: ftp=x');
    });

    await expect(resolveSystemProxy()).rejects.toThrow(
      'no usable proxy in ProxyServer value: ftp=x',
    );
  });

  it('rejects unsupported PAC configurations instead of bypassing them', async () => {
    win32Mock.mockReturnValue({ kind: 'pac', pacUrl: 'https://proxy.test/config.pac' });

    await expect(resolveSystemProxy()).rejects.toThrow(
      'PAC system proxy configuration is unsupported',
    );
  });
});

describe('fetchWithSystemProxy', () => {
  it('passes the resolved proxy to make-fetch-happen', async () => {
    const response = new Response('ok');
    win32Mock.mockReturnValue({
      kind: 'proxy',
      proxyUrl: 'http://system-proxy.test:8080',
      noProxy: ['localhost'],
    });
    fetchMock.mockResolvedValue(response);

    await expect(
      fetchWithSystemProxy('https://registry.test/pkg', {
        headers: { accept: 'application/json' },
        retry: 0,
      }),
    ).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledWith('https://registry.test/pkg', {
      headers: { accept: 'application/json' },
      retry: 0,
      proxy: 'http://system-proxy.test:8080',
      noProxy: ['localhost'],
    });
  });

  it('identifies the system proxy when a proxied request fails', async () => {
    win32Mock.mockReturnValue({
      kind: 'proxy',
      proxyUrl: 'http://system-proxy.test:8080',
      noProxy: [],
    });
    fetchMock.mockRejectedValue(new Error('connection refused'));

    await expect(fetchWithSystemProxy('https://registry.test/pkg', { retry: 0 })).rejects.toEqual(
      new DownloadError('connection refused (via system proxy http://system-proxy.test:8080)', {
        cause: expect.any(Error),
      }),
    );
  });
});

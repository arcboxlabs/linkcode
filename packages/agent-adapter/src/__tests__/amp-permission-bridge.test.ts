import { describe, expect, it } from 'vitest';
import { startAmpPermissionBridge } from '../native/amp/permission-bridge';

async function post(url: string, token: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-amp-bridge-token': token },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('amp permission bridge', () => {
  it('routes an authorized request through decide and echoes the decision', async () => {
    const bridge = await startAmpPermissionBridge((req) =>
      Promise.resolve(req.toolName === 'Bash' ? 'allow' : 'deny'),
    );
    try {
      const allowed = await post(bridge.url, bridge.token, {
        toolName: 'Bash',
        toolUseId: 't1',
        args: { cmd: 'ls' },
      });
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toEqual({ decision: 'allow' });

      const denied = await post(bridge.url, bridge.token, {
        toolName: 'Read',
        toolUseId: 't2',
        args: {},
      });
      expect(await denied.json()).toEqual({ decision: 'deny' });
    } finally {
      await bridge.close();
    }
  });

  it('403s a wrong token and never calls decide', async () => {
    let called = false;
    const bridge = await startAmpPermissionBridge(() => {
      called = true;
      return Promise.resolve('allow');
    });
    try {
      const res = await post(bridge.url, 'wrong-token', {
        toolName: 'Bash',
        toolUseId: 't1',
        args: {},
      });
      expect(res.status).toBe(403);
      expect(called).toBe(false);
    } finally {
      await bridge.close();
    }
  });

  it('fails closed (deny) on a malformed body', async () => {
    const bridge = await startAmpPermissionBridge(() => Promise.resolve('allow'));
    try {
      const res = await post(bridge.url, bridge.token, 'not-json');
      expect(await res.json()).toEqual({ decision: 'deny' });
    } finally {
      await bridge.close();
    }
  });
});

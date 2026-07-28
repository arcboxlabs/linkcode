import { WIRE_PROTOCOL_VERSION, WireMessageSchema } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

function accepts(payload: unknown): boolean {
  return WireMessageSchema.safeParse({
    v: WIRE_PROTOCOL_VERSION,
    id: 'message-1',
    ts: 0,
    payload,
  }).success;
}

describe('simulator wire variants', () => {
  it.each([
    { kind: 'simulator.status', clientReqId: 'r1' },
    {
      kind: 'simulator.status.result',
      replyTo: 'r1',
      status: { available: true, simctlPath: '/usr/bin/simctl', developerDir: '/dev' },
    },
    {
      kind: 'simulator.status.result',
      replyTo: 'r1',
      status: { available: false, reason: 'xcode missing' },
    },
    { kind: 'simulator.list', clientReqId: 'r2' },
    {
      kind: 'simulator.listed',
      replyTo: 'r2',
      devices: [
        {
          udid: 'U-1',
          name: 'iPhone 17',
          state: 'Shutdown',
          runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
          runtimeName: 'iOS 26.5',
          deviceType: null,
        },
      ],
    },
    { kind: 'simulator.devices.changed', devices: [] },
    { kind: 'simulator.boot', clientReqId: 'r3', sessionId: 'session-1', udid: 'U-1' },
    { kind: 'simulator.shutdown', clientReqId: 'r4', sessionId: 'session-1', udid: 'U-1' },
    {
      kind: 'simulator.install',
      clientReqId: 'r5',
      sessionId: 'session-1',
      udid: 'U-1',
      appPath: '/tmp/Fixture.app',
    },
    {
      kind: 'simulator.launch',
      clientReqId: 'r6',
      sessionId: 'session-1',
      udid: 'U-1',
      bundleId: 'com.example.app',
    },
    { kind: 'simulator.launched', replyTo: 'r6', pid: 4242 },
    { kind: 'simulator.launched', replyTo: 'r6', pid: null },
    {
      kind: 'simulator.open-url',
      clientReqId: 'r7',
      sessionId: 'session-1',
      udid: 'U-1',
      url: 'https://example.com',
    },
    { kind: 'simulator.screenshot', clientReqId: 'r8', sessionId: 'session-1', udid: 'U-1' },
    { kind: 'simulator.screenshotted', replyTo: 'r8', format: 'jpeg', data: 'aGVsbG8=' },
  ])('accepts $kind through the complete wire envelope', (payload) => {
    expect(accepts(payload)).toBe(true);
  });

  it.each([
    { kind: 'simulator.boot', clientReqId: 'r1', sessionId: 'session-1', udid: '' },
    { kind: 'simulator.screenshot', clientReqId: 'r1', sessionId: 'session-1' },
    { kind: 'simulator.screenshotted', replyTo: 'r1', format: 'gif', data: '' },
  ])('rejects malformed $kind', (payload) => {
    expect(accepts(payload)).toBe(false);
  });
});

import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

function envelope(payload: unknown) {
  return { v: WIRE_PROTOCOL_VERSION, id: 'message-1', ts: 1, payload };
}

const plugin = {
  provider: 'claude-code',
  id: 'formatter@marketplace',
  name: 'formatter',
  keywords: [],
  availability: 'available',
  installations: [{ enabled: true, scope: 'user' }],
  components: [{ kind: 'skill', name: 'render' }],
  assets: [],
  managementCapabilities: {
    install: false,
    uninstall: false,
    update: false,
    enable: true,
    disable: true,
  },
};

describe('plugin wire schema', () => {
  it('round-trips a discovery request with an optional cwd', () => {
    expect(
      parseWireMessage(envelope({ kind: 'plugin.list.get', clientReqId: 'request-1' })).success,
    ).toBe(true);
    expect(
      parseWireMessage(
        envelope({ kind: 'plugin.list.get', clientReqId: 'request-1', cwd: '/repo' }),
      ).success,
    ).toBe(true);
  });

  it('round-trips a discovery result with plugins, standalone skills, and provider status', () => {
    const parsed = parseWireMessage(
      envelope({
        kind: 'plugin.list.result',
        replyTo: 'request-1',
        plugins: [plugin],
        standaloneSkills: [
          {
            provider: 'claude-code',
            id: 'docx',
            name: 'docx',
            scope: 'user',
            path: '/home/user/.claude/skills/docx',
            enabled: true,
            toggleable: true,
          },
        ],
        providerStatus: [
          { provider: 'claude-code', ok: true },
          { provider: 'codex', ok: false, reason: 'binary not found' },
        ],
      }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.payload.kind !== 'plugin.list.result') return;
    expect(parsed.data.payload.providerStatus).toHaveLength(2);
  });

  it('accepts a plugin-level enable request with an explicit scope', () => {
    const parsed = parseWireMessage(
      envelope({
        kind: 'plugin.set-enabled',
        clientReqId: 'request-1',
        provider: 'claude-code',
        id: 'formatter@marketplace',
        enabled: false,
        scope: 'user',
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects an enable request for an unknown provider', () => {
    const parsed = parseWireMessage(
      envelope({
        kind: 'plugin.set-enabled',
        clientReqId: 'request-1',
        provider: 'opencode',
        id: 'formatter@marketplace',
        enabled: true,
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it('round-trips a per-skill enablement request and its reply', () => {
    const request = parseWireMessage(
      envelope({
        kind: 'skill.set-enabled',
        clientReqId: 'request-1',
        provider: 'claude-code',
        skillId: 'docx',
        path: '/home/user/.claude/skills/docx',
        scope: 'user',
        enabled: false,
      }),
    );
    expect(request.success).toBe(true);

    const reply = parseWireMessage(
      envelope({
        kind: 'skill.updated',
        replyTo: 'request-1',
        skill: {
          provider: 'claude-code',
          id: 'docx',
          name: 'docx',
          scope: 'user',
          path: '/home/user/.claude/skills/docx',
          enabled: false,
          toggleable: true,
        },
      }),
    );
    expect(reply.success).toBe(true);
    if (!reply.success || reply.data.payload.kind !== 'skill.updated') return;
    expect(reply.data.payload.skill.enabled).toBe(false);
  });

  it('round-trips the updated reply carrying the full plugin', () => {
    const parsed = parseWireMessage(
      envelope({ kind: 'plugin.updated', replyTo: 'request-1', plugin }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.payload.kind !== 'plugin.updated') return;
    expect(parsed.data.payload.plugin.id).toBe('formatter@marketplace');
  });
});

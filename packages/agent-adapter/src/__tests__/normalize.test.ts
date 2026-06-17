import { describe, expect, it } from 'vitest';
import { acpUpdateToEvent, mapAcpStop } from '../acp/acp-adapter';
import { mapClaudeStop } from '../native/claude-code';
import { mapCodexStatus, mapCodexUsage } from '../native/codex';
import { contentToText, toolKindFromName } from '../util';

describe('contentToText', () => {
  it('flattens text blocks and drops non-text', () => {
    expect(
      contentToText([
        { type: 'text', text: 'a' },
        { type: 'image', data: 'x', mimeType: 'image/png' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('a\nb');
  });
});

describe('toolKindFromName', () => {
  it('maps common tool names to ACP tool kinds', () => {
    expect(toolKindFromName('Read')).toBe('read');
    expect(toolKindFromName('Edit')).toBe('edit');
    expect(toolKindFromName('Bash')).toBe('execute');
    expect(toolKindFromName('Grep')).toBe('search');
    expect(toolKindFromName('WebFetch')).toBe('fetch');
    expect(toolKindFromName('Mystery')).toBe('other');
  });
});

describe('codex mappers', () => {
  it('passes status through', () => {
    expect(mapCodexStatus('in_progress')).toBe('in_progress');
    expect(mapCodexStatus('failed')).toBe('failed');
  });
  it('maps usage fields', () => {
    expect(
      mapCodexUsage({
        input_tokens: 10,
        output_tokens: 20,
        cached_input_tokens: 3,
        reasoning_output_tokens: 5,
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 3 });
  });
});

describe('stop reason mappers', () => {
  it('claude', () => {
    expect(mapClaudeStop('max_tokens')).toBe('max_tokens');
    expect(mapClaudeStop('tool_use')).toBe('end_turn');
    expect(mapClaudeStop(null)).toBe('end_turn');
  });
  it('acp (identity-ish)', () => {
    expect(mapAcpStop('refusal')).toBe('refusal');
    expect(mapAcpStop('something_else')).toBe('end_turn');
  });
});

describe('acpUpdateToEvent', () => {
  it('maps an agent message chunk', () => {
    expect(
      acpUpdateToEvent({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hi' },
        // biome-ignore lint/suspicious/noExplicitAny: test fixture shaped like an ACP SessionUpdate
      } as any),
    ).toEqual({ type: 'agent-message-chunk', content: { type: 'text', text: 'hi' } });
  });
  it('maps a tool call with fallbacks', () => {
    const event = acpUpdateToEvent({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      // biome-ignore lint/suspicious/noExplicitAny: test fixture shaped like an ACP SessionUpdate
    } as any);
    expect(event).toEqual({
      type: 'tool-call',
      toolCall: { toolCallId: 't1', title: 't1', kind: 'other', status: 'pending', content: [] },
    });
  });
  it('returns null for unknown updates', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test fixture shaped like an ACP SessionUpdate
    expect(acpUpdateToEvent({ sessionUpdate: 'something_new' } as any)).toBeNull();
  });
});

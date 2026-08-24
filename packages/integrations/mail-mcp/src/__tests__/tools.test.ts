import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import type { Address, MailImapClient, ReplyOrigin } from '../imap';
import type { MailSmtpClient } from '../smtp';
import type { MailToolDeps } from '../tools';
import { registerMailTools } from '../tools';

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

interface CapturedTool {
  cb: (args: Record<string, unknown>) => Promise<ToolResult>;
}

class FakeServer {
  readonly tools = new Map<string, CapturedTool>();
  registerTool(name: string, _config: unknown, cb: CapturedTool['cb']): void {
    this.tools.set(name, { cb });
  }
}

function makeDeps(
  imap: Partial<MailImapClient>,
  smtp: Partial<MailSmtpClient>,
  accountEmail = 'me@x.com',
): FakeServer {
  const server = new FakeServer();
  const fullImap: MailImapClient = {
    listFolders: vi.fn(),
    listMessages: vi.fn(),
    searchMessages: vi.fn(),
    getMessage: vi.fn(),
    getReplyOrigin: vi.fn(),
    markRead: vi.fn(),
    moveMessage: vi.fn(),
    close: vi.fn(),
    ...imap,
  };
  const fullSmtp: MailSmtpClient = {
    send: vi.fn(),
    close: vi.fn(),
    ...smtp,
  };
  const deps: MailToolDeps = { imap: fullImap, smtp: fullSmtp, accountEmail };
  // eslint-disable-next-line sukka/type/no-force-cast-via-top-type -- test fake of a 3rd-party class; only registerTool is exercised
  registerMailTools(server as unknown as McpServer, deps);
  return server;
}

function parseResult(r: ToolResult): { data: unknown; isError: boolean; text: string } {
  const text = r.content[0].text;
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // error results carry a plain message, not JSON
  }
  return { data, isError: r.isError === true, text };
}

describe('reply_message tool', () => {
  const origin: ReplyOrigin = {
    messageId: '<m1@x>',
    subject: 'Hi',
    from: [{ address: 'a@x.com' }] as Address[],
    to: [{ address: 'me@x.com' }, { address: 'c@x.com' }] as Address[],
    cc: [{ address: 'd@x.com' }] as Address[],
    references: ['<root@x>'],
  };

  it('replyAll drops the self address and extends the references chain', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '<r@x>', response: '250 OK' });
    const server = makeDeps({ getReplyOrigin: vi.fn().mockResolvedValue(origin) }, { send });
    const r = await server.tools.get('reply_message')!.cb({
      folder: 'INBOX',
      uid: 1,
      body: 'reply',
      replyAll: true,
    });
    expect(parseResult(r).isError).toBe(false);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@x.com, c@x.com, d@x.com',
        subject: 'Re: Hi',
        inReplyTo: '<m1@x>',
        references: ['<root@x>', '<m1@x>'],
      }),
    );
  });

  it('reply-to-sender only addresses From', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '<r@x>', response: '250' });
    const server = makeDeps({ getReplyOrigin: vi.fn().mockResolvedValue(origin) }, { send });
    await server.tools.get('reply_message')!.cb({ folder: 'INBOX', uid: 1, body: 'reply' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@x.com' }));
  });

  it('preserves a subject already prefixed with Re:', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '<r@x>', response: '250' });
    const server = makeDeps(
      { getReplyOrigin: vi.fn().mockResolvedValue({ ...origin, subject: 'Re: Hi' }) },
      { send },
    );
    await server.tools
      .get('reply_message')!
      .cb({ folder: 'INBOX', uid: 1, body: 'r', replyAll: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Re: Hi' }));
  });

  it('appends the original messageId only once even if already referenced', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '<r@x>', response: '250' });
    const server = makeDeps(
      {
        getReplyOrigin: vi
          .fn()
          .mockResolvedValue({ ...origin, references: ['<root@x>', '<m1@x>'] }),
      },
      { send },
    );
    await server.tools.get('reply_message')!.cb({ folder: 'INBOX', uid: 1, body: 'r' });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ references: ['<root@x>', '<m1@x>'] }),
    );
  });

  it('errors when the original has no replyable From', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '<r@x>', response: '250' });
    const server = makeDeps(
      { getReplyOrigin: vi.fn().mockResolvedValue({ ...origin, from: [] as Address[] }) },
      { send },
    );
    const r = await server.tools.get('reply_message')!.cb({ folder: 'INBOX', uid: 1, body: 'r' });
    expect(parseResult(r).isError).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('send_message tool', () => {
  it('passes args straight through to SMTP and returns the send result', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '<s@x>', response: '250' });
    const server = makeDeps({}, { send });
    const r = await server.tools.get('send_message')!.cb({
      to: 'a@x.com',
      subject: 'hello',
      body: 'hi',
      cc: 'c@x.com',
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@x.com', subject: 'hello', body: 'hi', cc: 'c@x.com' }),
    );
    expect(parseResult(r).data).toEqual({ messageId: '<s@x>', response: '250' });
  });
});

describe('list_messages tool', () => {
  it('clamps the limit into the allowed range before delegating', async () => {
    const listMessages = vi.fn().mockResolvedValue([]);
    const server = makeDeps({ listMessages }, {});
    await server.tools.get('list_messages')!.cb({ folder: 'INBOX', limit: 9999 });
    expect(listMessages).toHaveBeenCalledWith('INBOX', 100);
  });

  it('applies the default limit when omitted', async () => {
    const listMessages = vi.fn().mockResolvedValue([]);
    const server = makeDeps({ listMessages }, {});
    await server.tools.get('list_messages')!.cb({ folder: 'INBOX' });
    expect(listMessages).toHaveBeenCalledWith('INBOX', 20);
  });
});

describe('error handling', () => {
  it('surfaces a thrown tool error as isError=true, not a thrown exception', async () => {
    const listMessages = vi.fn().mockRejectedValue(new Error('boom'));
    const server = makeDeps({ listMessages }, {});
    const r = await server.tools.get('list_messages')!.cb({ folder: 'INBOX' });
    expect(parseResult(r).isError).toBe(true);
    expect(r.content[0].text).toContain('boom');
  });
});

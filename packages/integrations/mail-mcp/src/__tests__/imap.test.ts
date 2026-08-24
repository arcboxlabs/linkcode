import { trueFn } from 'foxts/noop';
import type { MailboxObject } from 'imapflow';
import { describe, expect, it, vi } from 'vitest';
import type { ImapFlowFactory, ImapFlowPort, MailImapClient, ReplyOrigin } from '../imap';
import { MailImap } from '../imap';
import type { MailConfig } from '../types';

function makeConfig(user = 'me@x.com'): MailConfig {
  return {
    imap: { host: 'h', port: 993, secure: true, user, password: 'p' },
    smtp: { host: 'h', port: 465, secure: true, user, password: 'p' },
    smtpFrom: user,
    maxBodyChars: 8000,
  };
}

function makeMailbox(exists: number): MailboxObject {
  return {
    path: 'INBOX',
    delimiter: '/',
    flags: new Set<string>(),
    uidValidity: 1n,
    uidNext: 1,
    exists,
  };
}

const lock = { release: vi.fn() };

function makeFlow(overrides: Partial<ImapFlowPort> = {}, mailboxExists = 10): ImapFlowPort {
  return {
    mailbox: makeMailbox(mailboxExists),
    connect: vi.fn(),
    logout: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    list: vi.fn(),
    getMailboxLock: vi.fn().mockResolvedValue(lock),
    search: vi.fn(),
    fetchOne: vi.fn(),
    fetchAll: vi.fn(),
    messageFlagsAdd: vi.fn(),
    messageFlagsRemove: vi.fn(),
    messageMove: vi.fn(),
    ...overrides,
  };
}

function makeImap(flow: ImapFlowPort): MailImapClient {
  return new MailImap(makeConfig(), () => flow);
}

function makeEventedFlow(
  overrides: Partial<ImapFlowPort> = {},
): ImapFlowPort & { emit(event: 'close' | 'error', error?: Error): void } {
  const listeners = new Map<string, Array<(error?: Error) => void>>();
  const flow = makeFlow(overrides) as ImapFlowPort & {
    on(event: 'close' | 'error', listener: (error?: Error) => void): void;
    emit(event: 'close' | 'error', error?: Error): void;
  };
  flow.on = (event, listener) => {
    const existing = listeners.get(event) ?? [];
    existing.push(listener);
    listeners.set(event, existing);
  };
  flow.emit = (event, error) => {
    for (const listener of listeners.get(event) ?? []) listener(error);
  };
  return flow;
}

describe('MailImap.listFolders', () => {
  it('maps folders with status counts', async () => {
    const list = vi.fn().mockResolvedValue([
      {
        path: 'INBOX',
        specialUse: String.raw`\Inbox`,
        status: { path: 'INBOX', messages: 5, unseen: 2 },
      },
      { path: 'Sent', specialUse: String.raw`\Sent`, status: { path: 'Sent', messages: 3 } },
    ]);
    const folders = await makeImap(makeFlow({ list })).listFolders();
    expect(folders).toEqual([
      { path: 'INBOX', specialUse: String.raw`\Inbox`, messages: 5, unseen: 2 },
      { path: 'Sent', specialUse: String.raw`\Sent`, messages: 3, unseen: undefined },
    ]);
  });

  it('shares an in-flight connection across concurrent calls', async () => {
    let resolveConnect: (() => void) | undefined;
    const connect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConnect = resolve;
        }),
    );
    const flow = makeFlow({ connect, list: vi.fn().mockResolvedValue([]) });
    const factory = vi.fn<ImapFlowFactory>(() => flow);
    const imap = new MailImap(makeConfig(), factory);

    const first = imap.listFolders();
    const second = imap.listFolders();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);

    resolveConnect?.();
    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
  });

  it('drops a closed connection and reconnects on the next call', async () => {
    const first = makeEventedFlow({ list: vi.fn().mockResolvedValue([]) });
    const second = makeEventedFlow({ list: vi.fn().mockResolvedValue([]) });
    const factory = vi.fn<ImapFlowFactory>().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const imap = new MailImap(makeConfig(), factory);

    await imap.listFolders();
    first.emit('close');
    await imap.listFolders();

    expect(factory).toHaveBeenCalledTimes(2);
    expect(second.connect).toHaveBeenCalledTimes(1);
  });

  it('handles an IMAP error, logs to stderr, and reconnects', async () => {
    const first = makeEventedFlow({ list: vi.fn().mockResolvedValue([]) });
    const second = makeEventedFlow({ list: vi.fn().mockResolvedValue([]) });
    const factory = vi.fn<ImapFlowFactory>().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(trueFn);
    const imap = new MailImap(makeConfig(), factory);

    await imap.listFolders();
    first.emit('error', new Error('socket reset'));
    await imap.listFolders();

    expect(stderr).toHaveBeenCalledWith(
      '[linkcode-mail-mcp] IMAP connection error: socket reset\n',
    );
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe('MailImap.listMessages', () => {
  it('fetches the last N by sequence range and returns newest-first', async () => {
    const fetchAll = vi.fn().mockImplementation((range: string) => {
      expect(range).toBe('1:10');
      return Promise.resolve([
        { uid: 1, seq: 1, envelope: { subject: 'old' } },
        { uid: 9, seq: 9, envelope: { subject: 'new' } },
      ]);
    });
    const msgs = await makeImap(makeFlow({ fetchAll })).listMessages('INBOX', 10);
    expect(msgs.map((m) => m.uid)).toEqual([9, 1]);
  });

  it('returns empty when the folder has no messages', async () => {
    expect(await makeImap(makeFlow({}, 0)).listMessages('INBOX', 20)).toEqual([]);
  });
});

describe('MailImap.searchMessages', () => {
  it('caps matched UIDs to the limit and sorts newest-first', async () => {
    const search = vi.fn().mockResolvedValue([1, 2, 3, 4, 5]);
    const fetchAll = vi.fn().mockImplementation((uids: number[]) => {
      expect(uids).toEqual([4, 5]);
      return Promise.resolve([
        { uid: 5, seq: 5, envelope: {} },
        { uid: 4, seq: 4, envelope: {} },
      ]);
    });
    const msgs = await makeImap(makeFlow({ search, fetchAll })).searchMessages(
      'INBOX',
      { subject: 'x' },
      2,
    );
    expect(msgs.map((m) => m.uid)).toEqual([5, 4]);
  });

  it('returns empty when search yields nothing', async () => {
    const search = vi.fn().mockResolvedValue(false);
    expect(await makeImap(makeFlow({ search })).searchMessages('INBOX', { from: 'x' }, 20)).toEqual(
      [],
    );
  });
});

describe('MailImap.getMessage', () => {
  const meta = {
    uid: 7,
    seq: 7,
    envelope: {
      subject: 'Hi',
      from: [{ name: 'A', address: 'a@x.com' }],
      to: [{ address: 'me@x.com' }],
      messageId: '<m1@x>',
      date: new Date('2026-01-01T00:00:00Z'),
    },
    bodyStructure: {
      type: 'multipart/mixed',
      childNodes: [
        { type: 'text/plain', part: '1', parameters: { charset: 'utf-8' } },
        {
          type: 'application/pdf',
          part: '2',
          disposition: 'attachment',
          dispositionParameters: { filename: 'a.pdf' },
          size: 100,
        },
      ],
    },
    flags: new Set([String.raw`\Seen`]),
    size: 42,
  };
  const bodyMsg = { bodyParts: new Map([['1', Buffer.from('hello body', 'utf-8')]]) };

  it('decodes the preferred text part, truncates, and lists attachments', async () => {
    const fetchOne = vi
      .fn()
      .mockImplementation((_seq: number, query: { bodyStructure?: unknown; bodyParts?: unknown }) =>
        Promise.resolve(query.bodyParts ? bodyMsg : meta),
      );
    const msg = await makeImap(makeFlow({ fetchOne })).getMessage('INBOX', 7);
    expect(msg.uid).toBe(7);
    expect(msg.subject).toBe('Hi');
    expect(msg.from).toBe('A <a@x.com>');
    expect(msg.body).toBe('hello body');
    expect(msg.attachments).toEqual([
      { part: '2', filename: 'a.pdf', contentType: 'application/pdf', size: 100 },
    ]);
  });

  it('truncates a body over the configured limit', async () => {
    const big = { bodyParts: new Map([['1', Buffer.from('x'.repeat(9000), 'utf-8')]]) };
    const fetchOne = vi
      .fn()
      .mockImplementation((_seq: number, query: { bodyStructure?: unknown; bodyParts?: unknown }) =>
        Promise.resolve(query.bodyParts ? big : meta),
      );
    const msg = await makeImap(makeFlow({ fetchOne })).getMessage('INBOX', 7);
    expect(msg.body?.length).toBeLessThan(9000);
    expect(msg.body).toContain('truncated');
  });

  it('throws when the message is missing', async () => {
    const fetchOne = vi.fn().mockResolvedValue(false);
    await expect(makeImap(makeFlow({ fetchOne })).getMessage('INBOX', 9)).rejects.toThrow(
      'not found',
    );
  });
});

describe('MailImap.getReplyOrigin', () => {
  it('parses a folded References header into a chain', async () => {
    const meta = {
      envelope: {
        subject: 'thread',
        from: [{ address: 'a@x.com' }],
        to: [{ address: 'me@x.com' }],
        cc: [{ address: 'b@x.com' }],
        messageId: '<m1@x>',
      },
      headers: Buffer.from('References: <root@x>\r\n <m1@x>\r\nOther: x\r\n', 'utf-8'),
    };
    const fetchOne = vi.fn().mockResolvedValue(meta);
    const origin: ReplyOrigin = await makeImap(makeFlow({ fetchOne })).getReplyOrigin('INBOX', 1);
    expect(origin.references).toEqual(['<root@x>', '<m1@x>']);
    expect(origin.from).toEqual([{ address: 'a@x.com' }]);
    expect(origin.messageId).toBe('<m1@x>');
  });
});

describe('MailImap.markRead / moveMessage', () => {
  it(String.raw`adds \Seen when read=true`, async () => {
    const messageFlagsAdd = vi.fn().mockResolvedValue(true);
    await makeImap(makeFlow({ messageFlagsAdd })).markRead('INBOX', 5, true);
    expect(messageFlagsAdd).toHaveBeenCalledWith(5, [String.raw`\Seen`], { uid: true });
  });

  it(String.raw`removes \Seen when read=false`, async () => {
    const messageFlagsRemove = vi.fn().mockResolvedValue(true);
    await makeImap(makeFlow({ messageFlagsRemove })).markRead('INBOX', 5, false);
    expect(messageFlagsRemove).toHaveBeenCalledWith(5, [String.raw`\Seen`], { uid: true });
  });

  it('moves a message by uid', async () => {
    const messageMove = vi.fn().mockResolvedValue({ destination: 'Archive' });
    await makeImap(makeFlow({ messageMove })).moveMessage('INBOX', 5, 'Archive');
    expect(messageMove).toHaveBeenCalledWith(5, 'Archive', { uid: true });
  });

  it('throws when move returns false', async () => {
    const messageMove = vi.fn().mockResolvedValue(false);
    await expect(
      makeImap(makeFlow({ messageMove })).moveMessage('INBOX', 5, 'Archive'),
    ).rejects.toThrow('Failed to move');
  });
});

import type {
  FetchMessageObject,
  FetchQueryObject,
  ImapFlowOptions,
  ListResponse,
  MailboxObject,
  MessageAddressObject,
  SearchObject,
} from 'imapflow';
import { ImapFlow } from 'imapflow';
import {
  collectAttachments,
  decodeBodyPart,
  pickPreferredPart,
  selectReadableParts,
  truncate,
} from './body';
import type { MailConfig } from './types';

export interface FolderSummary {
  readonly path: string;
  readonly specialUse?: string;
  readonly messages?: number;
  readonly unseen?: number;
}

export interface MessageSummary {
  readonly uid: number;
  readonly subject?: string;
  readonly from?: string;
  readonly to?: string;
  readonly date?: string;
  readonly flags?: string[];
  readonly size?: number;
}

export interface FullMessage {
  readonly uid: number;
  readonly subject?: string;
  readonly from?: string;
  readonly to?: string;
  readonly cc?: string;
  readonly date?: string;
  readonly messageId?: string;
  readonly inReplyTo?: string;
  readonly flags?: string[];
  readonly size?: number;
  readonly body?: string;
  readonly attachments: ReadonlyArray<{
    readonly part: string;
    readonly filename?: string;
    readonly contentType: string;
    readonly size?: number;
  }>;
}

export interface MailboxLock {
  release(): void;
}

export interface ImapFlowPort {
  readonly mailbox: MailboxObject | false;
  // Property-style so tests can reference the vi.fn() doubles without an unbound-method warning.
  connect: () => Promise<void>;
  logout(): Promise<void>;
  close(): void;
  on(event: 'error' | 'close', handler: (error?: unknown) => void): void;
  list(options?: { statusQuery?: Partial<Record<string, boolean>> }): Promise<ListResponse[]>;
  getMailboxLock(path: string, options?: { readOnly?: boolean }): Promise<MailboxLock>;
  search(query: SearchObject, options?: { uid?: boolean }): Promise<number[] | false>;
  fetchOne(
    seq: number,
    query: FetchQueryObject,
    options?: { uid?: boolean },
  ): Promise<FetchMessageObject | false>;
  fetchAll(
    range: string | number[],
    query: FetchQueryObject,
    options?: { uid?: boolean },
  ): Promise<FetchMessageObject[]>;
  messageFlagsAdd(range: number, flags: string[], options?: { uid?: boolean }): Promise<boolean>;
  messageFlagsRemove(range: number, flags: string[], options?: { uid?: boolean }): Promise<boolean>;
  messageMove(range: number, destination: string, options?: { uid?: boolean }): Promise<unknown>;
}

export interface ReplyOrigin {
  readonly messageId?: string;
  readonly subject?: string;
  readonly from: Address[];
  readonly to: Address[];
  readonly cc: Address[];
  readonly references: string[];
}

export interface MailImapClient {
  listFolders(): Promise<FolderSummary[]>;
  listMessages(folder: string, limit: number): Promise<MessageSummary[]>;
  searchMessages(
    folder: string,
    query: Record<string, unknown>,
    limit: number,
  ): Promise<MessageSummary[]>;
  getMessage(folder: string, uid: number): Promise<FullMessage>;
  getReplyOrigin(folder: string, uid: number): Promise<ReplyOrigin>;
  markRead(folder: string, uid: number, read: boolean): Promise<void>;
  moveMessage(folder: string, uid: number, destination: string): Promise<void>;
  close(): Promise<void>;
}

export type ImapFlowFactory = (config: MailConfig) => ImapFlowPort;

/** The subset of ImapFlow's EventEmitter surface used to keep cached connections healthy. */
interface EventedImapFlowPort {
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

const SEEN_FLAG = String.raw`\Seen`;

export class MailImap implements MailImapClient {
  private flow: ImapFlowPort | undefined;
  private connecting: Promise<ImapFlowPort> | undefined;
  private pendingFlow: ImapFlowPort | undefined;

  constructor(
    private readonly config: MailConfig,
    private readonly flowFactory?: ImapFlowFactory,
  ) {}

  async listFolders(): Promise<FolderSummary[]> {
    const flow = await this.ensureConnected();
    const folders = await flow.list({ statusQuery: { messages: true, unseen: true } });
    return folders.map((f) => ({
      path: f.path,
      specialUse: f.specialUse,
      messages: f.status?.messages,
      unseen: f.status?.unseen,
    }));
  }

  async listMessages(folder: string, limit: number): Promise<MessageSummary[]> {
    const flow = await this.ensureConnected();
    const lock = await flow.getMailboxLock(folder, { readOnly: true });
    try {
      const exists = flow.mailbox ? flow.mailbox.exists : 0;
      if (exists === 0) return [];
      const start = Math.max(1, exists - limit + 1);
      const range = `${start}:${exists}`;
      const messages = await flow.fetchAll(range, { envelope: true, flags: true, size: true }, {});
      return messages.reverse().map(toSummary);
    } finally {
      lock.release();
    }
  }

  async searchMessages(
    folder: string,
    query: SearchObject,
    limit: number,
  ): Promise<MessageSummary[]> {
    const flow = await this.ensureConnected();
    const lock = await flow.getMailboxLock(folder, { readOnly: true });
    try {
      const result = await flow.search(query, { uid: true });
      const uids = Array.isArray(result) ? result : [];
      if (uids.length === 0) return [];
      const capped = uids.slice(-limit);
      const messages = await flow.fetchAll(
        capped,
        { envelope: true, flags: true, size: true },
        { uid: true },
      );
      return messages.sort((a, b) => b.uid - a.uid).map(toSummary);
    } finally {
      lock.release();
    }
  }

  async getMessage(folder: string, uid: number): Promise<FullMessage> {
    const flow = await this.ensureConnected();
    const lock = await flow.getMailboxLock(folder, { readOnly: true });
    try {
      const meta = await flow.fetchOne(
        uid,
        { envelope: true, bodyStructure: true, flags: true, internalDate: true, size: true },
        { uid: true },
      );
      if (!meta) throw new Error(`Message uid=${uid} not found in ${folder}`);
      const structure = meta.bodyStructure;
      const readable = pickPreferredPart(selectReadableParts(structure));
      let body: string | undefined;
      if (readable) {
        const bodyMsg = await flow.fetchOne(uid, { bodyParts: [readable.part] }, { uid: true });
        const buf = bodyMsg ? bodyMsg.bodyParts?.get(readable.part) : undefined;
        body = truncate(decodeBodyPart(buf, readable.charset), this.config.maxBodyChars);
      }
      const attachments = collectAttachments(structure).map((a) => ({
        part: a.part,
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
      }));
      const env = meta.envelope;
      return {
        uid: meta.uid,
        subject: env?.subject,
        from: formatAddresses(env?.from),
        to: formatAddresses(env?.to),
        cc: formatAddresses(env?.cc),
        date: env?.date ? new Date(env.date).toISOString() : undefined,
        messageId: env?.messageId,
        inReplyTo: env?.inReplyTo,
        flags: meta.flags ? [...meta.flags] : undefined,
        size: meta.size,
        body,
        attachments,
      };
    } finally {
      lock.release();
    }
  }

  async getReplyOrigin(folder: string, uid: number): Promise<ReplyOrigin> {
    const flow = await this.ensureConnected();
    const lock = await flow.getMailboxLock(folder, { readOnly: true });
    try {
      const meta = await flow.fetchOne(
        uid,
        { envelope: true, headers: ['references'] },
        { uid: true },
      );
      if (!meta) throw new Error(`Message uid=${uid} not found in ${folder}`);
      const env = meta.envelope;
      return {
        messageId: env?.messageId,
        subject: env?.subject,
        from: toAddresses(env?.from),
        to: toAddresses(env?.to),
        cc: toAddresses(env?.cc),
        references: parseReferences(meta.headers),
      };
    } finally {
      lock.release();
    }
  }

  async markRead(folder: string, uid: number, read: boolean): Promise<void> {
    const flow = await this.ensureConnected();
    const lock = await flow.getMailboxLock(folder);
    try {
      if (read) await flow.messageFlagsAdd(uid, [SEEN_FLAG], { uid: true });
      else await flow.messageFlagsRemove(uid, [SEEN_FLAG], { uid: true });
    } finally {
      lock.release();
    }
  }

  async moveMessage(folder: string, uid: number, destination: string): Promise<void> {
    const flow = await this.ensureConnected();
    const lock = await flow.getMailboxLock(folder);
    try {
      const result = await flow.messageMove(uid, destination, { uid: true });
      if (result === false) throw new Error(`Failed to move uid=${uid} to ${destination}`);
    } finally {
      lock.release();
    }
  }

  async close(): Promise<void> {
    const flow = this.flow ?? this.pendingFlow;
    if (!flow) return;
    this.flow = undefined;
    this.pendingFlow = undefined;
    try {
      await flow.logout();
    } catch {
      flow.close();
    }
  }

  private async ensureConnected(): Promise<ImapFlowPort> {
    if (this.flow) return this.flow;
    if (this.connecting) return this.connecting;
    const connecting = this.connect();
    this.connecting = connecting;
    try {
      return await connecting;
    } finally {
      if (this.connecting === connecting) this.connecting = undefined;
    }
  }

  private async connect(): Promise<ImapFlowPort> {
    const flow = this.flowFactory ? this.flowFactory(this.config) : createImapFlow(this.config);
    this.pendingFlow = flow;
    this.attachLifecycleHandlers(flow);
    try {
      await flow.connect();
      // `close()` may have been called while the asynchronous connect was in progress.
      if (this.pendingFlow !== flow) {
        flow.close();
        throw new Error('IMAP connection closed while connecting');
      }
      this.flow = flow;
      return flow;
    } finally {
      if (this.pendingFlow === flow) this.pendingFlow = undefined;
    }
  }

  private attachLifecycleHandlers(flow: ImapFlowPort): void {
    if (!isEventedImapFlow(flow)) return;
    flow.on('close', () => this.invalidateFlow(flow));
    // An EventEmitter `error` event without a listener terminates Node. Log it on stderr (stdout
    // is MCP JSON-RPC) and invalidate the cached flow so the next tool call establishes a socket.
    flow.on('error', (error) => {
      this.invalidateFlow(flow);
      process.stderr.write(`[linkcode-mail-mcp] IMAP connection error: ${error.message}\n`);
    });
  }

  private invalidateFlow(flow: ImapFlowPort): void {
    if (this.flow === flow) this.flow = undefined;
    if (this.pendingFlow === flow) this.pendingFlow = undefined;
  }
}

function isEventedImapFlow(flow: ImapFlowPort): flow is ImapFlowPort & EventedImapFlowPort {
  return 'on' in flow && typeof flow.on === 'function';
}

function createImapFlow(config: MailConfig): ImapFlowPort {
  const options: ImapFlowOptions = {
    host: config.imap.host,
    port: config.imap.port,
    // ImapFlow logs to stdout by default; stdout is the MCP JSON-RPC channel, so disable.
    logger: false,
    secure: config.imap.secure,
    auth: { user: config.imap.user, pass: config.imap.password },
    // 163 rejects connections without an RFC 2971 ID response; ImapFlow sends it when clientInfo is set.
    clientInfo: { name: 'linkcode-mail-mcp', vendor: 'linkcode' },
  };
  return new ImapFlow(options);
}

export interface Address {
  readonly name?: string;
  readonly address?: string;
}

const RE_NEWLINE = /\r?\n/;
const RE_REFERENCES_LINE = /^references:/i;
const RE_REFERENCES_PREFIX = /^references:\s*/i;
const RE_FOLDED = /^\s/;
const RE_WS = /\s+/;

/** Parsed `References:` header chain (RFC 5322 message-id tokens), honoring folded continuation lines. */
function parseReferences(headers: Buffer | undefined): string[] {
  if (!headers) return [];
  const out: string[] = [];
  let capturing = false;
  for (const line of headers.toString('utf-8').split(RE_NEWLINE)) {
    if (RE_REFERENCES_LINE.test(line)) {
      capturing = true;
      for (const token of line.replace(RE_REFERENCES_PREFIX, '').trim().split(RE_WS)) {
        if (token) out.push(token);
      }
    } else if (capturing && RE_FOLDED.test(line)) {
      for (const token of line.trim().split(RE_WS)) {
        if (token) out.push(token);
      }
    } else if (capturing) {
      break;
    }
  }
  return out;
}

function toSummary(msg: FetchMessageObject): MessageSummary {
  const env = msg.envelope;
  return {
    uid: msg.uid,
    subject: env?.subject,
    from: formatAddresses(env?.from),
    to: formatAddresses(env?.to),
    date: env?.date ? new Date(env.date).toISOString() : undefined,
    flags: msg.flags ? [...msg.flags] : undefined,
    size: msg.size,
  };
}

function toAddresses(addresses?: MessageAddressObject[]): Address[] {
  if (!addresses) return [];
  const out: Address[] = [];
  for (const a of addresses) {
    if (a.name !== undefined || a.address !== undefined) {
      out.push({ name: a.name, address: a.address });
    }
  }
  return out;
}

export function formatAddresses(addresses?: readonly Address[]): string | undefined {
  if (!addresses || addresses.length === 0) return undefined;
  const parts: string[] = [];
  for (const a of addresses) {
    const formatted = a.name ? `${a.name} <${a.address ?? ''}>` : (a.address ?? '');
    if (formatted) parts.push(formatted);
  }
  return parts.length ? parts.join(', ') : undefined;
}

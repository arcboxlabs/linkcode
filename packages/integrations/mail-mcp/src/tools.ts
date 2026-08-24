import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { clamp } from 'foxts/clamp';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { z } from 'zod';
import type { Address, FullMessage, MailImapClient, MessageSummary } from './imap';
import { formatAddresses } from './imap';
import type { MailSmtpClient, SendResult } from './smtp';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

// The SDK's CallToolResult is inferred from a passthrough zod schema, so it carries a
// `[x: string]: unknown` index signature; mirror it so the helpers stay assignable.
interface TextContent {
  [x: string]: unknown;
  type: 'text';
  text: string;
}
interface ToolResult {
  [x: string]: unknown;
  content: TextContent[];
  isError?: boolean;
}

function json(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: extractErrorMessage(error) ?? 'unknown error' }],
    isError: true,
  };
}

async function run<T>(fn: () => Promise<T>): Promise<ToolResult> {
  try {
    return json(await fn());
  } catch (error) {
    return fail(error);
  }
}

/** Drop duplicate recipients by address (case-insensitive), preserving first-seen order. */
function dedupeAddresses(addresses: readonly Address[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const a of addresses) {
    const key = (a.address ?? '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export interface MailToolDeps {
  readonly imap: MailImapClient;
  readonly smtp: MailSmtpClient;
  /** Authenticated account address, used to drop the user from reply-all recipients. */
  readonly accountEmail: string;
}

export function registerMailTools(server: McpServer, deps: MailToolDeps): void {
  const { imap, smtp, accountEmail } = deps;

  server.registerTool(
    'list_folders',
    {
      description:
        'List all IMAP folders (mailboxes) for the account, with message and unseen counts.',
    },
    async () => run(() => imap.listFolders()),
  );

  server.registerTool(
    'list_messages',
    {
      description:
        'List the most recent messages in a folder. Returns summaries (uid, subject, from, to, date, flags, size).',
      inputSchema: {
        folder: z.string().min(1).describe('Folder path, e.g. INBOX or Sent'),
        limit: z
          .number()
          .int()
          .positive()
          .max(MAX_LIST_LIMIT)
          .optional()
          .describe(`Default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT}`),
      },
    },
    async ({ folder, limit }) =>
      run<MessageSummary[]>(() =>
        imap.listMessages(folder, clamp(limit ?? DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT)),
      ),
  );

  server.registerTool(
    'search_messages',
    {
      description:
        'Search messages in a folder by subject/from/to/body/seen/date. Returns matching message summaries.',
      inputSchema: {
        folder: z.string().min(1),
        subject: z.string().optional(),
        from: z.string().optional().describe('Sender name or address fragment'),
        to: z.string().optional(),
        body: z.string().optional().describe('Body text fragment'),
        seen: z.boolean().optional().describe('Filter by read state; omit for either'),
        since: z.string().optional().describe('ISO date; messages received after'),
        before: z.string().optional().describe('ISO date; messages received before'),
        limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional(),
      },
    },
    async (args) => {
      const { folder, limit, seen, ...rest } = args;
      const query: Record<string, unknown> = { ...rest };
      if (seen !== undefined) query.seen = seen;
      return run<MessageSummary[]>(() =>
        imap.searchMessages(folder, query, clamp(limit ?? DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT)),
      );
    },
  );

  server.registerTool(
    'get_message',
    {
      description:
        'Fetch a single message by uid: headers, decoded text body (truncated), and attachment metadata. Attachments are not downloaded.',
      inputSchema: {
        folder: z.string().min(1),
        uid: z.number().int().positive().describe('Message UID from list_messages/search_messages'),
      },
    },
    async ({ folder, uid }) => run<FullMessage>(() => imap.getMessage(folder, uid)),
  );

  server.registerTool(
    'send_message',
    {
      description: 'Send a new email over SMTP. `to`/`cc`/`bcc` accept comma-separated addresses.',
      inputSchema: {
        to: z.string().min(1),
        subject: z.string().min(1),
        body: z.string().min(1).describe('Plain-text body'),
        cc: z.string().optional(),
        bcc: z.string().optional(),
        html: z.string().optional().describe('Optional HTML body'),
        replyTo: z.string().optional(),
      },
    },
    async (args) => run<SendResult>(() => smtp.send(args)),
  );

  server.registerTool(
    'reply_message',
    {
      description:
        'Reply to a message by uid: fetches the original, sets In-Reply-To/References and `Re:` subject, sends via SMTP.',
      inputSchema: {
        folder: z.string().min(1),
        uid: z.number().int().positive(),
        body: z.string().min(1),
        html: z.string().optional(),
        replyAll: z
          .boolean()
          .optional()
          .describe('Reply to original To+Cc instead of just From (default false)'),
      },
    },
    async ({ folder, uid, body, html, replyAll }) =>
      run<SendResult>(async () => {
        const origin = await imap.getReplyOrigin(folder, uid);
        const recipients = replyAll ? [...origin.from, ...origin.to, ...origin.cc] : origin.from;
        const self = accountEmail.toLowerCase();
        const filtered = recipients.filter((a) => (a.address ?? '').toLowerCase() !== self);
        const to = formatAddresses(dedupeAddresses(filtered));
        if (!to) throw new Error('Original message has no replyable From address');
        const subject = origin.subject?.toLowerCase().startsWith('re:')
          ? origin.subject
          : `Re: ${origin.subject ?? ''}`;
        const references = [...origin.references];
        if (origin.messageId && !references.includes(origin.messageId)) {
          references.push(origin.messageId);
        }
        return smtp.send({
          to,
          subject,
          body,
          html,
          inReplyTo: origin.messageId,
          references,
        });
      }),
  );

  server.registerTool(
    'mark_read',
    {
      description: String.raw`Set or clear the \Seen flag on a message by uid.`,
      inputSchema: {
        folder: z.string().min(1),
        uid: z.number().int().positive(),
        read: z
          .boolean()
          .optional()
          .describe('true (default) marks as read; false marks as unread'),
      },
    },
    async ({ folder, uid, read }) => run(() => imap.markRead(folder, uid, read ?? true)),
  );

  server.registerTool(
    'move_message',
    {
      description: 'Move a message by uid from one folder to another.',
      inputSchema: {
        folder: z.string().min(1).describe('Source folder'),
        uid: z.number().int().positive(),
        destination: z.string().min(1).describe('Destination folder path'),
      },
    },
    async ({ folder, uid, destination }) => run(() => imap.moveMessage(folder, uid, destination)),
  );
}

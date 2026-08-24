import process from 'node:process';
// eslint-disable-next-line import-x/no-unresolved -- the SDK's exports-map subpaths (./server/*.js) defeat the resolver; tsc resolves them fine
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// eslint-disable-next-line import-x/no-unresolved -- same exports-map subpath as above
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { loadConfig } from './config';
import { MailImap } from './imap';
import { MailSmtp } from './smtp';
import { registerMailTools } from './tools';

const VERSION = '0.0.0';

async function main(): Promise<void> {
  const config = loadConfig();
  const imap = new MailImap(config);
  const smtp = new MailSmtp(config);
  const server = new McpServer(
    { name: 'linkcode-mail-mcp', version: VERSION },
    {
      instructions:
        'Read and send email over IMAP/SMTP for 163, QQ, and exmail accounts. Use list_folders, list_messages, search_messages, get_message, send_message, reply_message, mark_read, move_message. Credentials are supplied via the host environment and never appear in tool output.',
    },
  );
  registerMailTools(server, { imap, smtp, accountEmail: config.imap.user });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      try {
        await server.close();
      } catch {
        // best-effort during shutdown
      }
      await Promise.allSettled([imap.close(), smtp.close()]);
      process.exitCode = 0;
      if (signal) process.exit(0);
    })();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  process.stderr.write(
    `[linkcode-mail-mcp] fatal: ${extractErrorMessage(error) ?? 'unknown error'}\n`,
  );
  process.exit(1);
});

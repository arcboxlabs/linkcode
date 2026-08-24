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

// Build-time injected from package.json by tsup `define`; the fallback only covers unbundled runs.
declare const __MAIL_MCP_VERSION__: string | undefined;
const VERSION = typeof __MAIL_MCP_VERSION__ === 'string' ? __MAIL_MCP_VERSION__ : '0.0.0';

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
  const shutdown = (exitProcess = false): void => {
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
      if (exitProcess) process.exit(0);
    })();
  };

  process.on('SIGINT', () => shutdown(true));
  process.on('SIGTERM', () => shutdown(true));
  // The daemon owns stdin. If it dies or closes the MCP session, do not leave this plugin process
  // running with open IMAP/SMTP sockets.
  transport.onclose = () => shutdown(true);
}

main().catch((error) => {
  process.stderr.write(
    `[linkcode-mail-mcp] fatal: ${extractErrorMessage(error) ?? 'unknown error'}\n`,
  );
  process.exit(1);
});

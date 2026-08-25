/**
 * Dev marketplace for LinkCode plugin debugging: packs a synthetic `linkcode/echo` plugin into a
 * tgz with a manifest, writes an index.json (schema: LinkCodeMarketplaceIndexSchema), and serves
 * the directory over loopback HTTP with ETag support so the daemon's conditional refresh (304)
 * path is exercised too. The echo plugin is fully self-contained (its stdio MCP server payload is
 * inlined below) — real plugins ship via the marketplace index, never via this fixture.
 *
 * Usage:
 *   node scripts/dev-marketplace.mts            # build fixture + serve on 127.0.0.1:18741
 *   node scripts/dev-marketplace.mts --build    # build fixture only (no server)
 *
 * Point the dev daemon at it with:
 *   LINKCODE_MARKETPLACE_URL=http://127.0.0.1:18741/index.json pnpm -F @linkcode/daemon dev
 *
 * The manifest's mcp-server entry is package-relative, so the Engine resolves it against the
 * installed copy under the dev channel's plugin store. A session genuinely runs the artifact the
 * installer published — not the repo's dist.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import process from 'node:process';

const repoRoot = new URL('..', import.meta.url).pathname;
const outDir = join(repoRoot, 'node_modules', '.cache', 'dev-marketplace');

const PLUGIN_ID = 'linkcode/echo';
const VERSION = '0.1.0';
const PORT = Number(process.env.DEV_MARKETPLACE_PORT ?? 18741);

const buildOnly = process.argv.includes('--build');

const manifest = {
  manifestVersion: 1,
  id: PLUGIN_ID,
  version: VERSION,
  displayName: 'Echo（市场调试）',
  description: '合成调试插件：回显文本，覆盖 string / password(secret) / enum 三种设置形态。',
  keywords: ['echo', 'debug', 'marketplace'],
  components: [
    {
      kind: 'mcp-server',
      name: 'echo',
      description: 'Echo tool (returns the input text, optionally uppercased)',
      command: 'node',
      entry: 'dist/index.js',
      env: {
        ECHO_GREETING: 'greeting',
        ECHO_TOKEN: 'token',
        ECHO_MODE: 'mode',
      },
    },
  ],
  settings: {
    greeting: {
      type: 'string',
      label: '问候语',
      description: '回显内容的前缀',
      required: true,
    },
    token: {
      type: 'password',
      label: '令牌',
      description: '仅用于验证 secret 字段走 vault 而不落 config.json',
      secret: true,
      required: true,
    },
    mode: {
      type: 'enum',
      label: '模式',
      description: 'shout 会把回显内容转成大写',
      enum: ['plain', 'shout'],
      default: 'plain',
    },
  },
  assets: [],
};

// Minimal newline-delimited-JSON stdio MCP server with zero dependencies.
const MCP_PAYLOAD = `#!/usr/bin/env node
'use strict';
const readline = require('node:readline');

const GREETING = process.env.ECHO_GREETING || 'echo';
const MODE = process.env.ECHO_MODE || 'plain';

const ECHO_TOOL = {
  name: 'echo',
  description: 'Echo the input text back, prefixed with the configured greeting.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'Text to echo' } },
    required: ['text'],
  },
};

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
}
function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\\n');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined || msg.id === null) return; // notification
  switch (msg.method) {
    case 'initialize':
      reply(msg.id, {
        protocolVersion: (msg.params && msg.params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'echo', version: '${VERSION}' },
      });
      break;
    case 'ping':
      reply(msg.id, {});
      break;
    case 'tools/list':
      reply(msg.id, { tools: [ECHO_TOOL] });
      break;
    case 'tools/call': {
      const params = msg.params || {};
      if (params.name !== 'echo') {
        replyError(msg.id, -32602, 'unknown tool: ' + params.name);
        break;
      }
      const text = String((params.arguments && params.arguments.text) ?? '');
      const body = GREETING + ': ' + text;
      reply(msg.id, {
        content: [{ type: 'text', text: MODE === 'shout' ? body.toUpperCase() : body }],
      });
      break;
    }
    default:
      replyError(msg.id, -32601, 'method not found: ' + msg.method);
  }
});
`;

function buildFixture(): void {
  rmSync(outDir, { recursive: true, force: true });
  const staging = join(outDir, 'staging', 'package');
  mkdirSync(join(staging, 'dist'), { recursive: true });
  writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(staging, 'dist', 'index.js'), MCP_PAYLOAD);

  const tgzName = `echo-${VERSION}.tgz`;
  const tgzPath = join(outDir, tgzName);
  // The installer extracts with strip:1, so the archive must wrap everything in one top-level dir.
  execFileSync('tar', ['-czf', tgzPath, '-C', join(outDir, 'staging'), 'package']);
  rmSync(join(outDir, 'staging'), { recursive: true, force: true });

  const bytes = readFileSync(tgzPath);
  const integrity = `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
  const index = {
    indexVersion: 1,
    name: 'LinkCode Dev Marketplace',
    updatedAt: new Date().toISOString(),
    plugins: [
      {
        id: PLUGIN_ID,
        releases: [
          {
            manifest,
            artifact: {
              urls: [tgzName],
              integrity,
              size: bytes.length,
              format: 'tgz',
            },
            publishedAt: new Date().toISOString(),
          },
        ],
      },
    ],
  };
  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`fixture ready: ${outDir} (${tgzName} ${bytes.length} bytes, ${integrity})`);
}

function serve(): void {
  const server = createServer((req, res) => {
    const path = req.url === '/' ? '/index.json' : (req.url ?? '/');
    const file = join(outDir, path);
    if (!file.startsWith(outDir) || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    const bytes = readFileSync(file);
    const etag = `"${createHash('sha1').update(bytes).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304).end();
      return;
    }
    res.writeHead(200, {
      'content-type': extname(file) === '.tgz' ? 'application/gzip' : 'application/json',
      'content-length': String(bytes.length),
      etag,
    });
    res.end(bytes);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`dev marketplace serving at http://127.0.0.1:${PORT}/index.json`);
  });
}

buildFixture();
if (buildOnly) {
  console.log(`(build only; stat: ${statSync(join(outDir, 'index.json')).size} bytes index)`);
} else {
  serve();
}

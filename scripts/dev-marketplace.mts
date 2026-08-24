/**
 * Dev marketplace for LinkCode plugin debugging: packs @linkcode/mail-mcp into a tgz with a
 * manifest, writes an index.json (schema: LinkCodeMarketplaceIndexSchema), and serves the
 * directory over loopback HTTP with ETag support so the daemon's conditional refresh (304) path
 * is exercised too.
 *
 * Usage:
 *   node scripts/dev-marketplace.mts            # build fixture + serve on 127.0.0.1:18741
 *   node scripts/dev-marketplace.mts --build    # build fixture only (no server)
 *
 * Point the dev daemon at it with:
 *   LINKCODE_MARKETPLACE_URL=http://127.0.0.1:18741/index.json pnpm -F @linkcode/daemon dev
 *
 * The manifest's mcp-server args point at the INSTALLED copy under the dev channel's plugin
 * store (~/.linkcode.development/plugins/...), so a session genuinely runs the artifact the
 * installer published — not the repo's dist.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import process from 'node:process';

const repoRoot = new URL('..', import.meta.url).pathname;
const outDir = join(repoRoot, 'node_modules', '.cache', 'dev-marketplace');
const mailDist = join(repoRoot, 'packages', 'integrations', 'mail-mcp', 'dist');

const PLUGIN_ID = 'linkcode/mail';
const VERSION = '0.1.0';
const PORT = Number(process.env.DEV_MARKETPLACE_PORT ?? 18741);

const buildOnly = process.argv.includes('--build');

const manifest = {
  manifestVersion: 1,
  id: PLUGIN_ID,
  version: VERSION,
  displayName: '邮箱（163 / QQ）',
  description: '通过 IMAP 收信、SMTP 发信，支持 163、QQ 和腾讯企业邮箱（授权码登录）。',
  keywords: ['mail', 'imap', 'smtp', '163', 'qq'],
  components: [
    {
      kind: 'mcp-server',
      name: 'mail',
      description: 'IMAP/SMTP mail tools (list/search/read/send/reply/mark/move)',
      command: 'node',
      entry: 'dist/index.js',
      env: {
        MAIL_USER: 'account',
        MAIL_PASSWORD: 'authcode',
        MAIL_PRESET: 'preset',
      },
    },
  ],
  settings: {
    account: {
      type: 'string',
      label: '邮箱账号',
      description: '完整邮箱地址，例如 you@163.com',
      required: true,
    },
    authcode: {
      type: 'password',
      label: '授权码',
      description: '邮箱网页端生成的客户端授权码，不是登录密码',
      secret: true,
      required: true,
    },
    preset: {
      type: 'enum',
      label: '服务商',
      enum: ['163', 'qq', 'exmail'],
      default: '163',
    },
  },
  assets: [],
};

function buildFixture(): void {
  if (!existsSync(join(mailDist, 'index.js'))) {
    console.error(
      'packages/integrations/mail-mcp/dist is missing — run: pnpm -F @linkcode/mail-mcp build',
    );
    process.exit(1);
  }
  rmSync(outDir, { recursive: true, force: true });
  const staging = join(outDir, 'staging', 'package');
  mkdirSync(join(staging, 'dist'), { recursive: true });
  writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  copyFileSync(join(mailDist, 'index.js'), join(staging, 'dist', 'index.js'));

  const tgzName = `mail-${VERSION}.tgz`;
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

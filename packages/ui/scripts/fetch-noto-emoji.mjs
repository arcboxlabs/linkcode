// Fetches the vendored monochrome Noto Emoji at install time so the 418KB binary stays out of
// git. The artifact is frozen — v2018-08-10-unicode11 is the last static release of the
// monochrome face (later Google Fonts builds are variable and fail to parse in restty's text
// shaper) — so a pinned tag + content hash gives the same determinism as committing the bytes.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const URL_TTF =
  'https://raw.githubusercontent.com/googlefonts/noto-emoji/v2018-08-10-unicode11/fonts/NotoEmoji-Regular.ttf';
const SHA256 = '415dc6290378574135b64c808dc640c1df7531973290c4970c51fdeb849cb0c5';
const DEST = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/shell/terminal/vendor/noto-emoji-regular.ttf',
);

function hashOf(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function isFresh() {
  try {
    return hashOf(readFileSync(DEST)) === SHA256;
  } catch {
    return false;
  }
}

async function main() {
  if (isFresh()) return;
  const response = await fetch(URL_TTF);
  if (!response.ok) {
    throw new Error(`download failed: HTTP ${response.status} ${URL_TTF}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = hashOf(bytes);
  if (actual !== SHA256) {
    throw new Error(`checksum mismatch: expected ${SHA256}, got ${actual}`);
  }
  mkdirSync(dirname(DEST), { recursive: true });
  writeFileSync(DEST, bytes);
  console.log('[ui/fetch-noto-emoji] fetched noto-emoji-regular.ttf');
}

main().catch((error) => {
  console.error('[ui/fetch-noto-emoji]', error);
  process.exit(1);
});

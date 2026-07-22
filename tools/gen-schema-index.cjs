#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const WIRE_DIR = path.join(__dirname, '..', 'packages', 'foundation', 'schema', 'src', 'wire');
const OUTPUT = path.join(__dirname, '..', 'docs', 'SCHEMA-INDEX.md');

// Fire-and-forget and broadcast messages without clientReqId or replyTo.
// Every uncorrelated kind must be listed here; missing = error.
const UNCORRELATED_DIRECTIONS = new Map([
  ['ping', 'C->H'],
  ['pong', 'H->C'],

  ['terminal.detach', 'C->H'],
  ['terminal.input', 'C->H'],
  ['terminal.resize', 'C->H'],
  ['terminal.close', 'C->H'],
  ['terminal.ack', 'C->H'],

  ['terminal.output', 'H->C'],
  ['terminal.resized', 'H->C'],
  ['terminal.controller.changed', 'H->C'],
  ['terminal.exit', 'H->C'],

  ['session.attach', 'C->H'],
  ['session.detach', 'C->H'],

  ['session.notification', 'H->C'],

  ['agent-login.url', 'H->C'],
  ['agent-login.submit-code', 'C->H'],
  ['agent-login.cancel', 'C->H'],
  ['agent-login.settled', 'H->C'],

  ['agent.event', 'H->C'],

  ['agent-runtime.changed', 'H->C'],

  ['asset.progress', 'H->C'],
  ['asset.settled', 'H->C'],

  ['loop.changed', 'H->C'],
  ['loop.removed', 'H->C'],
  ['loop.iteration', 'H->C'],
  ['loop.log', 'H->C'],

  ['schedule.changed', 'H->C'],
  ['schedule.removed', 'H->C'],
  ['schedule.run', 'H->C'],

  ['script.status', 'H->C'],
]);

/**
 * @typedef {{ kind: string, file: string, direction: string, doc: string }} Variant
 */

/**
 * @param {string} filePath
 * @returns {Variant[]}
 */
function parseWireFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);
  const lines = text.split('\n');
  const variants = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/kind:\s*z\.literal\('([^']+)'\)/);
    if (!match) continue;

    const kind = match[1];
    const objStart = findObjectStart(lines, i);
    const objBlock = objStart >= 0 ? extractBlock(lines, objStart) : '';
    const doc = objStart >= 0 ? extractDoc(lines, objStart - 1) : '';
    const direction = classifyFromBlock(objBlock, kind);

    variants.push({ kind, file: fileName, direction, doc });
  }

  return variants;
}

/**
 * Walk backwards from `idx` to find the line containing `z.object({`.
 * @param {string[]} lines
 * @param {number} idx
 * @returns {number}
 */
function findObjectStart(lines, idx) {
  if (lines[idx].includes('z.object({')) return idx;

  let cursor = idx - 1;
  while (cursor >= 0) {
    if (lines[cursor].includes('z.object({')) return cursor;
    if (lines[cursor].trim() === ']);') return -1;
    cursor--;
  }
  return -1;
}

/**
 * Extract the balanced `z.object({...})` block starting at `start` line.
 * @param {string[]} lines
 * @param {number} start
 * @returns {string}
 */
function extractBlock(lines, start) {
  let depth = 0;
  let found = false;
  const blockLines = [];

  for (let j = start; j < lines.length; j++) {
    blockLines.push(lines[j]);
    for (let k = 0; k < lines[j].length; k++) {
      const ch = lines[j][k];
      if (ch === '{') {
        depth++;
        found = true;
      } else if (ch === '}') {
        depth--;
      }
      if (found && depth === 0) return blockLines.join('\n');
    }
  }
  return blockLines.join('\n');
}

/**
 * Extract JSDoc or line comment ending at line `idx`.
 * Collects consecutive `//` lines and `/**` blocks.
 * @param {string[]} lines
 * @param {number} idx
 * @returns {string}
 */
function extractDoc(lines, idx) {
  if (idx < 0) return '';
  const docLines = [];
  let cursor = idx;
  while (cursor >= 0) {
    const trimmed = lines[cursor].trim();
    if (trimmed.startsWith('*') && !trimmed.startsWith('*/')) {
      docLines.unshift(trimmed.replace(/^\*\s?/, '').replace(/\s*\*\/$/, ''));
    } else if (trimmed === '*/') {
      cursor--;
      while (cursor >= 0) {
        const inner = lines[cursor].trim();
        if (inner.startsWith('/**')) {
          docLines.unshift(inner.replace(/^\/\*\*\s*/, ''));
          break;
        }
        if (inner.startsWith('*')) {
          docLines.unshift(inner.replace(/^\*\s?/, '').replace(/\s*\*\/$/, ''));
        }
        cursor--;
      }
      break;
    } else if (trimmed.startsWith('/**')) {
      docLines.unshift(trimmed.replace(/^\/\*\*\s*/, '').replace(/\s*\*\/$/, ''));
      break;
    } else if (trimmed.startsWith('//')) {
      docLines.unshift(trimmed.replace(/^\/\/\s*/, ''));
    } else if (trimmed !== '') {
      break;
    }
    cursor--;
  }
  return docLines.join(' ').trim();
}

/**
 * Determine direction from the zod object block.
 * - has clientReqId: C to H (request)
 * - has replyTo:     H to C (response)
 * - neither:         look up UNCORRELATED_DIRECTIONS, error if unknown
 * @param {string} block
 * @param {string} kind
 * @returns {string}
 */
function classifyFromBlock(block, kind) {
  const hasClientReqId = /clientReqId/.test(block);
  const hasReplyTo = /replyTo/.test(block);

  if (hasClientReqId && hasReplyTo) return 'C<->H';
  if (hasClientReqId) return 'C->H';
  if (hasReplyTo) return 'H->C';

  const direction = UNCORRELATED_DIRECTIONS.get(kind);
  if (!direction) {
    throw new Error('Cannot determine direction for uncorrelated kind: ' + kind);
  }
  return direction;
}

/**
 * @param {Variant[]} variants
 * @returns {string}
 */
function generateMarkdown(variants) {
  const sorted = variants.slice().sort((a, b) => a.kind.localeCompare(b.kind));

  let c2h = 0;
  let h2c = 0;
  let ch = 0;
  for (let i = 0; i < sorted.length; i++) {
    const d = sorted[i].direction;
    if (d === 'C->H') c2h++;
    else if (d === 'H->C') h2c++;
    else ch++;
  }

  const rows = sorted
    .map((v) => {
      const doc = v.doc ? ' ' + v.doc : '';
      return '| `' + v.kind + '` | ' + v.direction + ' | `' + v.file + '` |' + doc;
    })
    .join('\n');

  return [
    '<!-- GENERATED by tools/gen-schema-index.cjs -- DO NOT EDIT MANUALLY -->',
    '',
    '# Wire Schema Index',
    '',
    'Every `WirePayload` variant, sorted by `kind`.',
    'Generated from `packages/foundation/schema/src/wire/*.ts`.',
    '',
    '**' +
      sorted.length +
      '** message kinds . C->H: ' +
      c2h +
      ' . H->C: ' +
      h2c +
      ' . C<->H: ' +
      ch,
    '',
    '| kind | direction | source file | description |',
    '|------|-----------|-------------|-------------|',
    rows,
    '',
  ].join('\n');
}

// -- main --

const files = fs
  .readdirSync(WIRE_DIR)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'message.ts' && f !== 'payload.ts');

/** @type {Variant[]} */
let allVariants = [];
for (let i = 0; i < files.length; i++) {
  allVariants = allVariants.concat(parseWireFile(path.join(WIRE_DIR, files[i])));
}

const markdown = generateMarkdown(allVariants);

if (process.argv.includes('--check')) {
  if (!fs.existsSync(OUTPUT)) {
    console.error(
      'ERROR: docs/SCHEMA-INDEX.md does not exist. Run `node tools/gen-schema-index.cjs` to generate it.',
    );
    process.exit(1);
  }
  const existing = fs.readFileSync(OUTPUT, 'utf-8');
  if (existing !== markdown) {
    console.error(
      'ERROR: docs/SCHEMA-INDEX.md is out of date. Run `node tools/gen-schema-index.cjs` to regenerate it.',
    );
    process.exit(1);
  }
  console.log('docs/SCHEMA-INDEX.md is up to date.');
} else {
  fs.writeFileSync(OUTPUT, markdown, 'utf-8');
  console.log('Generated ' + OUTPUT + ' -- ' + allVariants.length + ' message kinds.');
}

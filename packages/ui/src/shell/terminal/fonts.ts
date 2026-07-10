import ibmPlexMono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?inline';
import ibmPlexMono700 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2?inline';
import type { ResttyFontInput } from 'restty';
// Not in git: fetched (pinned tag + sha256) by scripts/fetch-noto-emoji.mjs on install. If the
// import fails to resolve, run `pnpm -F @linkcode/ui postinstall`.
import notoEmojiTtf from './vendor/noto-emoji-regular.ttf?inline';

function decodeDataUri(uri: string): ArrayBuffer {
  const binary = atob(uri.slice(uri.indexOf(',') + 1));
  return Uint8Array.from(binary, (ch) => ch.codePointAt(0) ?? 0).buffer;
}

interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
}

/**
 * Fallback families resolved from the user's installed fonts, in priority order (first present
 * wins). Resolution happens here, not in restty: listing several restty `family` inputs would
 * load every matching font whole (CJK families are 20-55 MB each), and restty's own local
 * matching gives no cross-family priority.
 */
const SYMBOLS_FAMILIES = [
  'symbols nerd font',
  'symbols nerd font mono',
  'jetbrainsmono nerd font',
  'jetbrains mono nerd font',
  'fira code nerd font',
  'hack nerd font',
  'meslo lgm nerd font',
  'meslo lgs nf',
  'meslolgs nf',
  'caskaydia',
  'cascadia code nf',
  'monaspace nerd font',
  'nerd font mono',
  'nerd font',
  'powerline',
];

// CJK priority. Arial Unicode MS leads deliberately: it ships with every macOS, covers common
// CJK, and its tall metrics dodge restty's wide-glyph upscale, keeping mixed CJK/latin lines on
// one baseline (CODE-138). PingFang is deliberately absent: it parses (variable TTC) but
// rasterizes every glyph blank in restty's text shaper. A bare 'hiragino sans' matcher is equally
// hazardous: the Japanese Hiragino Sans lacks simplified-Chinese glyphs — only the GB variant is
// safe.
const CJK_FAMILIES = [
  'arial unicode',
  'hiragino sans gb',
  'heiti sc',
  'microsoft yahei',
  'noto sans cjk',
  'source han sans',
];

// Color emoji: only Apple Color Emoji (sbix) is verified to render in restty 0.2.0. Segoe UI
// Emoji (COLR) is unverified on a real Windows machine and restty prefers a color-classified
// font for emoji presentation unconditionally, so an unrenderable color font in the chain blanks
// every emoji — do not add one without a rendering screenshot.
const COLOR_EMOJI_FAMILIES = ['apple color emoji'];

const MONO_FAMILIES = ['sf mono', 'menlo', 'monaco', 'consolas', 'dejavu sans mono'];

function pickLocalFamily(fonts: readonly LocalFontData[], matchers: string[]): string | null {
  for (const matcher of matchers) {
    const hit = fonts.find((font) =>
      `${font.family} ${font.fullName} ${font.postscriptName}`.toLowerCase().includes(matcher),
    );
    if (hit) return hit.family;
  }
  return null;
}

async function queryLocalFontsSafe(): Promise<readonly LocalFontData[]> {
  const query = (window as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
  if (!query) return [];
  try {
    return await query();
  } catch {
    // Local Font Access denied or unavailable — bundled fonts still cover latin + mono emoji.
    return [];
  }
}

let terminalFontsPromise: Promise<ResttyFontInput[]> | null = null;

async function buildTerminalFonts(): Promise<ResttyFontInput[]> {
  const local = await queryLocalFontsSafe();
  // An empty probe usually means a transient failure (Electron grants Local Font Access without
  // a gesture, but a denial or a flaky first call shouldn't pin the degraded bundled-only list
  // for the whole session) — serve the fallback now, retry on the next terminal open.
  if (local.length === 0) terminalFontsPromise = null;
  const symbols = pickLocalFamily(local, SYMBOLS_FAMILIES);
  const cjk = pickLocalFamily(local, CJK_FAMILIES);
  const colorEmoji = pickLocalFamily(local, COLOR_EMOJI_FAMILIES);
  const mono = pickLocalFamily(local, MONO_FAMILIES);
  return [
    // restty renders on a GPU canvas with its own text shaper and needs raw font bytes; its
    // default font chain fetches from cdn.jsdelivr.net, which the renderer CSP blocks — always
    // pass fonts explicitly. Both Plex weights ship inline so bold is a real face, not the
    // synthetic double-draw.
    { data: decodeDataUri(ibmPlexMono400), name: 'IBM Plex Mono', weight: 400 },
    { data: decodeDataUri(ibmPlexMono700), name: 'IBM Plex Mono Bold', weight: 700 },
    ...(symbols ? [{ family: symbols }] : []),
    ...(cjk ? [{ family: cjk }] : []),
    // Bundled monochrome emoji (vendored Noto Emoji, Unicode 11 / Apache 2.0 — the last static
    // release; newer Google Fonts builds fail to parse in restty's shaper) backstops machines
    // without a renderable color emoji font.
    colorEmoji ? { family: colorEmoji } : { data: decodeDataUri(notoEmojiTtf), name: 'Noto Emoji' },
    ...(mono ? [{ family: mono }] : []),
  ];
}

/** Resolve the terminal font list once per renderer session (installed fonts don't change mid-run). */
export function resolveTerminalFonts(): Promise<ResttyFontInput[]> {
  terminalFontsPromise ??= buildTerminalFonts();
  return terminalFontsPromise;
}

import ibmPlexMono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?inline';
import ibmPlexMono700 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2?inline';
import notoEmoji from '@fontsource/noto-emoji/files/noto-emoji-emoji-400-normal.woff2?inline';
import type { ResttyFontInput } from 'restty';

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

// CJK priority, best quality first — needs restty ≥0.2.3 (wide fallbacks keep natural scale on
// the primary baseline; restty#24). PingFang stays out: it claims glyphs but rasterizes them
// blank — restty ≥0.2.1 skips such faces (restty#25) but has never rendered it. A bare
// 'hiragino sans' matcher is unsafe: the Japanese variant lacks simplified-Chinese glyphs.
const CJK_FAMILIES = [
  'hiragino sans gb',
  'heiti sc',
  'microsoft yahei',
  'noto sans cjk',
  'source han sans',
  'arial unicode',
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

const terminalFontsCache = new Map<string, Promise<ResttyFontInput[]>>();

async function buildTerminalFonts(preferredFamily: string): Promise<ResttyFontInput[]> {
  const local = await queryLocalFontsSafe();
  // An empty probe usually means a transient failure (Electron grants Local Font Access without
  // a gesture, but a denial or a flaky first call shouldn't pin the degraded bundled-only list
  // for the whole session) — serve the fallback now, retry on the next terminal open.
  if (local.length === 0) terminalFontsCache.delete(preferredFamily);
  const symbols = pickLocalFamily(local, SYMBOLS_FAMILIES);
  const cjk = pickLocalFamily(local, CJK_FAMILIES);
  const colorEmoji = pickLocalFamily(local, COLOR_EMOJI_FAMILIES);
  const mono = pickLocalFamily(local, MONO_FAMILIES);
  // A user-chosen family leads the chain (`local: 'prefer'` falls back to the bundled fonts when
  // the machine lacks it); empty keeps the bundled IBM Plex Mono as the primary face.
  const trimmed = preferredFamily.trim();
  const preferred: ResttyFontInput[] =
    trimmed === '' || trimmed === 'default' ? [] : [{ family: trimmed, local: 'prefer' }];
  return [
    ...preferred,
    // restty renders on a GPU canvas with its own text shaper and needs raw font bytes; its
    // default font chain fetches from cdn.jsdelivr.net, which the renderer CSP blocks — always
    // pass fonts explicitly. Both Plex weights ship inline so bold is a real face, not the
    // synthetic double-draw.
    { data: decodeDataUri(ibmPlexMono400), name: 'IBM Plex Mono', weight: 400 },
    { data: decodeDataUri(ibmPlexMono700), name: 'IBM Plex Mono Bold', weight: 700 },
    ...(symbols ? [{ family: symbols }] : []),
    ...(cjk ? [{ family: cjk }] : []),
    // Bundled monochrome emoji backstops machines without a renderable color emoji font
    // (current Noto Emoji builds parse since text-shaper 0.1.26; text-shaper#3).
    colorEmoji ? { family: colorEmoji } : { data: decodeDataUri(notoEmoji), name: 'Noto Emoji' },
    ...(mono ? [{ family: mono }] : []),
  ];
}

/** Resolve the terminal font list for a chosen family (cached — installed fonts don't change mid-run). */
export function resolveTerminalFonts(preferredFamily = 'default'): Promise<ResttyFontInput[]> {
  let fonts = terminalFontsCache.get(preferredFamily);
  if (!fonts) {
    fonts = buildTerminalFonts(preferredFamily);
    terminalFontsCache.set(preferredFamily, fonts);
  }
  return fonts;
}

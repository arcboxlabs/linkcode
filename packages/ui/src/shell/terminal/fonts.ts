import ibmPlexMonoWoff2 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?inline';
import type { ResttyFontSource } from 'restty';
import notoEmojiTtf from './vendor/noto-emoji-regular.ttf?inline';

function decodeDataUri(uri: string): ArrayBuffer {
  const binary = atob(uri.slice(uri.indexOf(',') + 1));
  return Uint8Array.from(binary, (ch) => ch.codePointAt(0) ?? 0).buffer;
}

// restty renders on a GPU canvas with its own text shaper and needs raw font bytes; its default
// `fontPreset: 'default-cdn'` fetches from cdn.jsdelivr.net, which the renderer CSP blocks. Bundle
// IBM Plex Mono inline instead (no network, no CDN).
//
// Fallback ordering caveats (restty 0.1.35, all verified against real rendering — CODE-138):
// - Within one `local` source, matcher order is irrelevant: restty scans `queryLocalFonts()`
//   enumeration order (≈ alphabetical by PostScript name) and loads the FIRST font matching ANY
//   matcher. Priority between families must come from separate sources or from enumeration order.
// - Every `local` source that matches loads its whole font file into memory (CJK families are
//   20-55 MB each), so CJK stays a single source: one source loads at most one font.
export const TERMINAL_FONT_SOURCES: ResttyFontSource[] = [
  { type: 'buffer', data: decodeDataUri(ibmPlexMonoWoff2), label: 'IBM Plex Mono' },
  // Fall back to the user's installed fonts for glyphs IBM Plex Mono lacks — Nerd/powerline
  // icons via the Local Font Access API when the host allows it. Match both full Nerd Font
  // names and common abbreviated NF family names such as MesloLGS NF / CaskaydiaCove NF.
  {
    type: 'local',
    matchers: [
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
    ],
    label: 'symbols',
  },
  // CJK: single source, alphabetical enumeration resolves the platform default — Arial Unicode MS
  // on macOS (the only stock font whose metrics keep mixed CJK/latin lines on one baseline; its
  // tall line metrics dodge restty's wide-glyph upscale), Microsoft YaHei on Windows, Noto/Source
  // Han on Linux. PingFang is deliberately absent: it parses (variable TTC) but rasterizes every
  // glyph blank in restty's text shaper, claiming codepoints and rendering nothing. A bare
  // 'hiragino sans' matcher is equally hazardous: it wins alphabetically and the Japanese
  // Hiragino Sans lacks simplified-Chinese glyphs (tofu) — only the GB variant is safe.
  {
    type: 'local',
    matchers: [
      'arial unicode',
      'hiragino sans gb',
      'heiti sc',
      'microsoft yahei',
      'noto sans cjk',
      'source han sans',
    ],
    label: 'cjk',
  },
  // Bundled monochrome emoji (vendored Noto Emoji, Unicode 11 / Apache 2.0 — the last static
  // release; the current Google Fonts Noto Emoji, variable or instanced, fails to parse in
  // restty's shaper, so emoji added after 2018 render as tofu). Color emoji fonts (Apple Color
  // Emoji sbix, Segoe UI Emoji) load but rasterize blank, and restty prefers a color-classified
  // font for emoji presentation regardless of order — local color fonts must stay out of the
  // chain until upstream supports them.
  { type: 'buffer', data: decodeDataUri(notoEmojiTtf), label: 'emoji' },
  {
    type: 'local',
    matchers: ['sf mono', 'menlo', 'monaco', 'consolas', 'dejavu sans mono'],
    label: 'mono',
  },
];

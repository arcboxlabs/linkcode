/**
 * SGR/CSI/OSC escape stripper for plain-text terminal rendering (the native tool-detail
 * sheet has no ANSI renderer yet — color mapping is a follow-up; web keeps `ansi-to-react`).
 *
 * Covers `ESC [ … final`, `ESC ] … (BEL | ESC \)` and single-char `ESC @…_` sequences.
 */
const ANSI_RE =
  // eslint-disable-next-line no-control-regex -- matching the ESC/BEL bytes is the whole point
  /\u{1B}(?:\[[\d;?]*[\u{20}-\u{2F}]*[\u{40}-\u{7E}]|\][^\u{7}\u{1B}]*(?:\u{7}|\u{1B}\\)|[\u{40}-\u{5A}\u{5C}-\u{5F}])/gu;

export function stripAnsi(text: string): string {
  return text.replaceAll(ANSI_RE, '');
}

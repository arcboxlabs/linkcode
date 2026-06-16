/**
 * CoSSUI design tokens. The UI design draws on CodeX (PLAN §4.6).
 * 🔧 The underlying CoSSUI component library is not yet decided; for now this uses inline styles + tokens as a placeholder implementation.
 */
export const tokens = {
  color: {
    bg: '#0e0f12',
    surface: '#16181d',
    border: '#262a33',
    text: '#e6e8ec',
    textMuted: '#9aa1ad',
    accent: '#6ea8fe',
    danger: '#f08a8a',
    success: '#7fd6a3',
  },
  radius: { sm: 6, md: 10, lg: 14 },
  space: (n: number): number => n * 4,
  font: {
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
} as const;

export type Tokens = typeof tokens;

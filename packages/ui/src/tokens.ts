/**
 * CoSSUI 设计 token。UI 设计参考 CodeX（PLAN §4.6）。
 * 🔧 CoSSUI 底层组件库未定，当前以内联样式 + token 作为占位实现。
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

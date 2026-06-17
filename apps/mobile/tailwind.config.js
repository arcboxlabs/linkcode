// NativeWind uses Tailwind v3 with its preset. Palette mirrors CoSSUI (see packages/ui/src/theme.css)
// so utility names (bg-bg / text-muted / border-border / text-accent) match the web/desktop side.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#0e0f12',
        surface: '#16181d',
        border: '#262a33',
        text: '#e6e8ec',
        muted: '#9aa1ad',
        accent: '#6ea8fe',
        danger: '#f08a8a',
        success: '#7fd6a3',
      },
    },
  },
  plugins: [],
};

// NativeWind v5 uses Tailwind v4 CSS-first configuration in src/global.css.
// Keep this file as a lightweight editor/tooling fallback.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
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

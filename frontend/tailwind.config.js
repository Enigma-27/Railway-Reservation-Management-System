/** @type {import('tailwindcss').Config} */

// Colour families are CSS variables (rgb channels) defined in public/rrms-palette.css, one set per theme.
// This is how the staff and admin pages (plain Tailwind classes) follow the light / dark toggle.
const FAMILIES = ['slate', 'emerald', 'rose', 'orange', 'amber', 'blue', 'indigo', 'purple', 'cyan'];
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const palette = Object.fromEntries(
  FAMILIES.map((f) => [f, Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--c-${f}-${s}) / <alpha-value>)`]))]),
);

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--rrms-font)'],
        display: ['var(--rrms-font-display)'],
        mono: ['var(--rrms-font-mono)'],
      },
      colors: {
        ...palette,
        // the shared RRMS tokens (same values as public/rrms-theme.css), usable as text-brand, bg-brand, border-line ...
        brand: { DEFAULT: 'var(--rrms-primary)', hover: 'var(--rrms-primary-hover)', soft: 'var(--rrms-primary-soft)', link: 'var(--rrms-link)' },
        ink: { DEFAULT: 'var(--rrms-text)', muted: 'var(--rrms-text-muted)' },
        line: { DEFAULT: 'var(--rrms-border-soft)', strong: 'var(--rrms-border)' },
        surf: { DEFAULT: 'var(--rrms-surface)', alt: 'var(--rrms-surface-alt)' },
        base: 'var(--rrms-bg)',
        accent: { DEFAULT: 'var(--rrms-accent)', text: 'var(--rrms-accent-text)' },
        rrms: {
          primary: 'var(--rrms-primary)',
          'primary-hover': 'var(--rrms-primary-hover)',
          'primary-soft': 'var(--rrms-primary-soft)',
          text: 'var(--rrms-text)',
          muted: 'var(--rrms-text-muted)',
          bg: 'var(--rrms-bg)',
          border: 'var(--rrms-border)',
          success: 'var(--st-confirmed)',
          danger: 'var(--st-cancelled)',
          warning: 'var(--st-rac)',
        },
      },
    },
  },
  plugins: [],
};

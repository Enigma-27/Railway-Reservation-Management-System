/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // The shared RRMS tokens (same values as public/rrms-theme.css)
        rrms: {
          primary: '#2259c2',
          'primary-hover': '#1a479e',
          'primary-soft': '#eaf1fd',
          text: '#0f172a',
          muted: '#475569',
          bg: '#f4f7fb',
          border: '#dbe3ee',
          success: '#047857',
          danger: '#b91c1c',
          warning: '#a15207',
        },
        // CONTRAST FIX AT THE ROOT. These Tailwind shades are used for TEXT all over the staff and admin screens
        // and were below WCAG AA (4.5:1) on white: slate-400 2.6:1, slate-500 4.4:1 on the page grey, gray-400 2.5:1, emerald-600 3.6:1, orange-600 (white text) 3.6:1.
        // Darkening the shade fixes every use at once. All new values are >= 4.5:1 on white and on slate-50.
        slate: { 400: '#5b6b82', 500: '#586479' },
        gray: { 400: '#6b7280' },
        orange: { 600: '#c2410c' },
        emerald: { 600: '#047857' },
        admin: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
          950: '#431407',
        }
      }
    },
  },
  plugins: [],
}

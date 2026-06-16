/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        goblin: {
          50: 'rgb(var(--goblin-50) / <alpha-value>)',
          100: 'rgb(var(--goblin-100) / <alpha-value>)',
          200: 'rgb(var(--goblin-200) / <alpha-value>)',
          300: 'rgb(var(--goblin-300) / <alpha-value>)',
          400: 'rgb(var(--goblin-400) / <alpha-value>)',
          500: 'rgb(var(--goblin-500) / <alpha-value>)',
          600: 'rgb(var(--goblin-600) / <alpha-value>)',
          700: 'rgb(var(--goblin-700) / <alpha-value>)',
          800: 'rgb(var(--goblin-800) / <alpha-value>)',
          900: 'rgb(var(--goblin-900) / <alpha-value>)',
          950: 'rgb(var(--goblin-950) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};

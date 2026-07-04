/**
 * Shared Tailwind preset for all Goblins front-ends (POS, back office, KDS).
 * Import it from each app's tailwind.config.js:
 *
 *   import goblinPreset from '../../packages/ui/tailwind-preset.js';
 *   export default { presets: [goblinPreset], content: [...] };
 *
 * The `goblin` color scale is driven by CSS variables defined in theme.css, so
 * the same utility classes track the active theme + light/dark automatically.
 *
 * @type {import('tailwindcss').Config}
 */

// Intermediate stops (650/750/850) used as hover shades — a 50/50 mix of the
// adjacent themed vars, so they track every theme + light/dark with no hand-tuning.
const midStop = (a, b) => `color-mix(in srgb, rgb(var(${a})), rgb(var(${b})))`;

export default {
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
          650: midStop('--goblin-600', '--goblin-700'),
          700: 'rgb(var(--goblin-700) / <alpha-value>)',
          750: midStop('--goblin-700', '--goblin-800'),
          800: 'rgb(var(--goblin-800) / <alpha-value>)',
          850: midStop('--goblin-800', '--goblin-900'),
          900: 'rgb(var(--goblin-900) / <alpha-value>)',
          950: 'rgb(var(--goblin-950) / <alpha-value>)',
        },
        yellow: {
          // Non-standard stops referenced by VIP/highlight badges.
          250: '#fdea6b',
          450: '#f5c211',
        },
      },
      spacing: {
        4.5: '1.125rem',
        5.5: '1.375rem',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
};

import goblinPreset from '../../packages/ui/tailwind-preset.js';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [goblinPreset],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // on iPad a tapped button would otherwise keep its hover colour until the next tap elsewhere
  future: { hoverOnlyWhenSupported: true },
};

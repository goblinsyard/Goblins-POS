import goblinPreset from '../../packages/ui/tailwind-preset.js';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [goblinPreset],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
};

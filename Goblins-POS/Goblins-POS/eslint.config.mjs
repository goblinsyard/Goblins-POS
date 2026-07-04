import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/*.config.js', '**/*.config.ts', 'apps/api/prisma/migrations/**', 'qa-shot.mjs', 'qa-shots/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // Prisma JSON values & framework boundaries need pragmatic escapes
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/*.tsx'],
    languageOptions: { globals: { window: 'readonly', document: 'readonly', navigator: 'readonly' } },
  },
);

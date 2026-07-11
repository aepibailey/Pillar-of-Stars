import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Node-side tooling scripts (not shipped in the app bundle). These drive a
    // headless browser, so they touch both Node and DOM globals.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', localStorage: 'readonly' },
    },
  },
);

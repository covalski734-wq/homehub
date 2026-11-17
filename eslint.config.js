import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.wrangler/**',
      'tools/pg-to-d1/legacy-postgres/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: [
      'packages/shared/**/*.ts',
      'tools/**/*.{ts,mjs}',
      'apps/api/scripts/**/*.mjs',
      'apps/web/scripts/**/*.mjs',
      'scripts/**/*.mjs',
      '**/*.config.{ts,js}',
      '**/*.cjs',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Cloudflare Worker: Web-standard globals (fetch, crypto, Request…).
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    // In Workers console output is the logging channel (Workers Logs); the migration tool is a CLI.
    files: [
      'apps/api/src/**/*.ts',
      'apps/api/scripts/**/*.mjs',
      'apps/web/scripts/**/*.mjs',
      'scripts/**/*.mjs',
      'tools/**/*.{ts,mjs}',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/web/public/**/*.js'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['apps/web/src/components/ui/**/*.tsx', 'apps/web/src/providers/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  prettier,
);

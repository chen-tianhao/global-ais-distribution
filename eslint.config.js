import js from '@eslint/js';

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  self: 'readonly',
  performance: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  location: 'readonly',
  history: 'readonly',
  requestAnimationFrame: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  Worker: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Blob: 'readonly',
  ArrayBuffer: 'readonly',
};

const nodeGlobals = {
  process: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  fetch: 'readonly',
};

export default [
  {
    ignores: [
      'dist/**',
      'data/**',
      'node_modules/**',
      '.npm-cache/**',
      '.tmp-*/**',
      '*.csv',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: browserGlobals,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'vite.config.js', 'vitest.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: { ...nodeGlobals, describe: 'readonly', it: 'readonly', expect: 'readonly' },
    },
  },
];

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginAstro from 'eslint-plugin-astro';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**', '.astro/**'],
  },

  // Base JS recommended
  js.configs.recommended,

  // TypeScript recommended (spread array)
  ...tseslint.configs.recommended,

  // Astro recommended (spread array)
  ...eslintPluginAstro.configs.recommended,

  // Prettier — disables rules that conflict with Prettier (must be last)
  eslintConfigPrettier,

  // Project-specific overrides
  {
    files: ['src/**/*.{ts,tsx,astro,mjs,js}'],
    rules: {
      // Allow unused vars prefixed with _
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Node.js scripts — declare Node globals to suppress no-undef false positives
  {
    files: ['scripts/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortController: 'readonly',
        Response: 'readonly',
      },
    },
  },

  // Playwright scripts that use page.evaluate() — need browser globals inside callbacks
  {
    files: ['scripts/screenshot-audit.mjs', 'scripts/visual-test.mjs'],
    languageOptions: {
      globals: {
        document: 'readonly',
        getComputedStyle: 'readonly',
        window: 'readonly',
      },
    },
  },
];

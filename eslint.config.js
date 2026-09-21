import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '.npm-cache/**', 'electron/**']
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Browser-side code (React app)
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },

  // Node-side code (backend, build configs, tests)
  {
    files: ['server/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  // Shared code runs in BOTH environments
  {
    files: ['shared/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    }
  },

  // Project-wide rule tuning
  {
    rules: {
      // Empty catch blocks are used deliberately for best-effort cleanup
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Any remaining `any` should be visible as a warning until fully removed
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },

  // Disable stylistic rules that conflict with Prettier (must stay last)
  prettier
);

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      'data/**',
      'models/**',
      'test-results/**',
      'playwright-report/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The analyser returns model output; `unknown` plus a coercion layer is
      // the pattern used there, so a blanket ban on `any` is what we want.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'apps/server/src/harness/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', TransformStream: 'readonly' },
    },
    rules: { 'no-undef': 'off' },
  },
  prettier,
)

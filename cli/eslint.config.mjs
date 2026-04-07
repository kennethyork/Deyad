import eslint from '@typescript-eslint/eslint-plugin';
import parser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts', 'bin/**/*.ts'],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': eslint,
    },
    rules: {
      ...eslint.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-function': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    ignores: ['node_modules/', 'dist/', '*.config.ts', '*.config.mts'],
  },
];

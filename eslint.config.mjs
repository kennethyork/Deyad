import eslint from '@typescript-eslint/eslint-plugin';
import parser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': eslint,
    },
    rules: {
      ...eslint.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/triple-slash-reference': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    ignores: ['node_modules/', 'out/', '.vite/', 'dist/', 'e2e/', 'cli/', '*.config.ts', '*.config.mts', 'forge.env.d.ts'],
  },
];

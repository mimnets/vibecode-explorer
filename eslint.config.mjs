import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/**', 'node_modules/**', '.vscode-test/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/webview/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { window: 'readonly', document: 'readonly', acquireVsCodeApi: 'readonly', cytoscape: 'readonly', getComputedStyle: 'readonly' },
    },
  },
);

import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'
// dharness:eslint-import begin — rewritten by `dharness sync`; edits here are lost.
import dharnessPlugin from "dharness-eslint-plugin";
import dharnessLayer from "./.dharness/eslint.config.mjs";
// dharness:eslint-import end

// Architecture boundaries are enforced by fallow (.dharness/fallow.jsonc), not here.
export default [
  // dharness:eslint-layer begin — rewritten by `dharness sync`; edits here are lost.
  ...dharnessLayer({ plugin: dharnessPlugin }),
  // dharness:eslint-layer end
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'node_modules/**',
      '.atl/**',
      'research_notes/**',
      'reports/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/backend/**/*.ts', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  },
  prettier
]

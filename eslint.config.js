import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'research_notes/**', 'reports/**'] },
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
  {
    // Hexagonal rule from docs/architecture.md: domain code imports no adopted tool.
    files: ['src/backend/{correction,feedback,profile,ports}/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@earendil-works/*', 'openworkflow', 'openworkflow/*', 'hono', 'hono/*', '@hono/*'],
              message: 'Domain code must not import adopted tools; go through a port.'
            },
            {
              group: ['node:sqlite', 'electron'],
              message: 'Domain code must not import infrastructure; go through a port.'
            },
            { group: ['**/adapters/**'], message: 'Domain code must not depend on adapters.' }
          ]
        }
      ]
    }
  },
  prettier
)

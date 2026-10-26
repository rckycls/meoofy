import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.expo/**',
    '.worktrees/**',
    '.superpowers/**',
    'supabase/.temp/**',
    // Not committed yet and outside the workspace (pnpm-workspace.yaml); remove with that line.
    'apps/video/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Plain JS config files run in Node, and the app's (babel, metro, jest)
    // are CommonJS, which Metro and Jest load with require().
    files: ['**/*.{js,cjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)

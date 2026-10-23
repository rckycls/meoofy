import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.expo/**',
    '.worktrees/**',
    '.superpowers/**',
    'supabase/.temp/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
)

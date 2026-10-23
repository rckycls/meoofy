// Metro in the pnpm monorepo (Expo's monorepo guide): watch the whole
// workspace so edits to the source-only packages (@pawpin/ui, api, core,
// all `main: ./src/index.ts`) rebuild, and resolve modules from the app's
// node_modules first, then the hoisted root node_modules.
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = config

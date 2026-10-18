import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

/**
 * Modules the server component loads at runtime instead of bundling: the Node builtins, and the Pi packages,
 * which are ESM-only and resolve their own files at runtime (as in electron.vite.config.ts). `build:server`
 * installs the Pi packages beside the bundle.
 */
const serverExternals = [/^@earendil-works\/.+/, ...builtinModules.flatMap((name) => [name, `node:${name}`])]

// The backend as the server component (docs/signed-releases.md): one bundled entry in out/server/.
export default defineConfig({
  build: {
    ssr: 'src/backend/entry.ts',
    outDir: 'out/server',
    emptyOutDir: true,
    target: 'node24',
    rollupOptions: { external: serverExternals, output: { entryFileNames: 'entry.js' } }
  },
  ssr: { noExternal: true }
})

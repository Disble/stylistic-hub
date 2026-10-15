import { builtinModules } from 'node:module'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

/**
 * Modules the main process loads at runtime instead of bundling. A custom `external`
 * replaces electron-vite's default list, so Electron and the Node builtins are restated.
 * Pi packages join this list when they are added: they are ESM-only and resolve their
 * own files at runtime (same setup as dhub).
 */
const mainExternals = [
  'electron',
  /^electron\/.+/,
  ...builtinModules.flatMap((name) => [name, `node:${name}`])
]

export default defineConfig({
  main: {
    build: {
      rollupOptions: { external: mainExternals }
    }
  },
  preload: {
    build: {
      // Sandboxed preload scripts must be CommonJS.
      rollupOptions: {
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: { plugins: [react()] }
})

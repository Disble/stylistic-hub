// Compiles native/word-hook/stylistic-hook.c into resources/word/stylistic-hook.dll, the 64-bit DLL that keeps
// the trigger document's Word window off screen (docs/architecture.md). Needs a MinGW-w64 gcc on PATH (MSYS2
// ucrt64); Word on Windows is 64-bit.
// Usage: bun scripts/build-word-hook.ts [--trace] (part of `bun run dist`). --trace builds a diagnostic DLL that
// logs what it does to %TEMP%\stylistic-hook.log.
import { execFileSync } from 'node:child_process'

/** The hook's source. */
const source = 'native/word-hook/stylistic-hook.c'
/** Where the loader script finds the hook, next to itself. */
const output = 'resources/word/stylistic-hook.dll'

/** Compiler flags for the diagnostic build. */
const trace = process.argv.includes('--trace') ? ['-DSTYLISTIC_HOOK_TRACE'] : []

try {
  execFileSync(
    'gcc',
    [
      ...trace,
      '-shared',
      '-O2',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-static-libgcc',
      '-s',
      '-o',
      output,
      source,
      '-luser32'
    ],
    {
      stdio: 'inherit'
    }
  )
} catch (error) {
  console.error(
    `Could not compile ${source}: install MSYS2's mingw-w64-ucrt-x86_64-gcc and put its bin on PATH.`
  )
  throw error
}
console.log(`Built ${output}${trace.length ? ' (trace)' : ''}`)

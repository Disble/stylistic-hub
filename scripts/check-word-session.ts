// Parses resources/word/word-session.ps1 the way Windows PowerShell would, so a syntax error in the Word loader
// fails `bun run check` instead of only showing up on the user's machine as a loader that never loads (it has
// happened twice: a `$name:` reference and a variable that collided with a parameter). Windows-only; skipped with
// a note when powershell.exe is not on PATH.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The loader the hub supervises in every Word session. */
const loader = fileURLToPath(new URL('../resources/word/word-session.ps1', import.meta.url))

/** Asks PowerShell to parse the loader and to report every syntax error it finds. */
const parse = `
$errors = $null
$tokens = $null
[void][System.Management.Automation.Language.Parser]::ParseFile('${loader.replace(/'/g, "''")}', [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Output ('{0}:{1} {2}' -f $_.Extent.StartLineNumber, $_.Extent.StartColumnNumber, $_.Message) }
  exit 1
}
exit 0
`

if (!existsSync(loader)) {
  console.error(`Missing ${loader}`)
  process.exit(1)
}

try {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parse], {
    stdio: 'inherit'
  })
  console.log(`${loader} parses`)
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    console.log('powershell.exe is not on PATH; the Word loader was not parsed')
  } else {
    throw error
  }
}

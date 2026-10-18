# Asks for the root key passphrase without echoing it, then runs the key ceremony (docs/keys.md).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\keys\ceremony.ps1 [-Out <dir>] [-DryRun]
param([string]$Out = (Join-Path $HOME 'stylistic-root-keys'), [switch]$DryRun)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')

function Read-Secret([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

Write-Host 'Stylistic signing key ceremony. Keep the passphrase in your password manager: without it the root keys are useless.'
$first = Read-Secret 'Root key passphrase (at least 12 characters)'
$second = Read-Secret 'Repeat the passphrase'
if ($first -ne $second) { Write-Host 'The passphrases differ. Nothing was created.'; exit 1 }

$env:STYLISTIC_ROOT_PASSPHRASE = $first
try {
  $arguments = @('scripts/keys/ceremony.ts', '--out', $Out)
  if ($DryRun) { $arguments += @('--dry-run', '--public', (Join-Path $Out 'public')) }
  & bun @arguments
  if ($LASTEXITCODE -ne 0) { Write-Host 'The ceremony failed; read the message above.'; exit $LASTEXITCODE }
} finally {
  Remove-Item Env:STYLISTIC_ROOT_PASSPHRASE -ErrorAction SilentlyContinue
}
Write-Host 'Done. Back up the folder above (USB drive or password manager), then you can close this window.'

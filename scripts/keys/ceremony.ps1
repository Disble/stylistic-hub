# Asks for the root key passphrase, then runs the key ceremony (docs/keys.md).
# The passphrase is typed in the clear in this window only, shown back for a yes/no check, so a typo is caught
# before anything is created; pressing Enter on an empty line generates a strong one instead and copies it to
# the clipboard. Every step is logged (never the passphrase or a private key) to %TEMP%\stylistic-ceremony.log.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\keys\ceremony.ps1 [-Out <dir>] [-DryRun]
param([string]$Out = (Join-Path $HOME 'stylistic-root-keys'), [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'stylistic-ceremony.log'
Set-Location (Join-Path $PSScriptRoot '..\..')

function Write-Log([string]$message) {
  Write-Host $message
  Add-Content -Path $log -Value ("{0:u} {1}" -f (Get-Date), $message)
}

function New-Passphrase {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $chars = $bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] }
  ((0..5) | ForEach-Object { -join $chars[($_ * 4)..($_ * 4 + 3)] }) -join '-'
}

Set-Content -Path $log -Value ("{0:u} ceremony started (out: {1}, dry run: {2})" -f (Get-Date), $Out, $DryRun)
Write-Host 'Stylistic signing key ceremony.'
Write-Host 'Type your root key passphrase (at least 12 characters). It is shown as you type, in this window only.'
Write-Host 'Or press Enter on an empty line to generate a strong one.'
while ($true) {
  $passphrase = Read-Host 'Passphrase'
  if ($passphrase -eq '') {
    $passphrase = New-Passphrase
    Set-Clipboard -Value $passphrase
    Write-Host 'Generated (also copied to the clipboard):'
  } elseif ($passphrase.Length -lt 12) {
    Write-Log "That passphrase has $($passphrase.Length) characters; it needs at least 12. Try again."
    continue
  }
  Write-Host ''
  Write-Host "    $passphrase" -ForegroundColor Green
  Write-Host ''
  $answer = Read-Host 'Is this exactly right, and saved in your password manager? (y/n)'
  if ($answer -match '^(y|s|yes|si)$') { break }
  Write-Log 'Not confirmed. Try again.'
}
Clear-Host
Set-Clipboard -Value ' '
Write-Log 'Passphrase confirmed (not logged). Creating the keys and the GitHub secrets...'

$env:STYLISTIC_ROOT_PASSPHRASE = $passphrase
try {
  $arguments = @('scripts/keys/ceremony.ts', '--out', $Out)
  if ($DryRun) { $arguments += @('--dry-run', '--public', (Join-Path $Out 'public')) }
  & bun @arguments 2>&1 | ForEach-Object { Write-Log "$_" }
  if ($LASTEXITCODE -ne 0) { Write-Log "The ceremony failed (exit $LASTEXITCODE); the log is $log"; exit $LASTEXITCODE }
} finally {
  Remove-Item Env:STYLISTIC_ROOT_PASSPHRASE -ErrorAction SilentlyContinue
}
Write-Log 'Done. Back up the folder above (USB drive or password manager), then you can close this window.'

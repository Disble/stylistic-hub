# Asks for the root key passphrase, then rotates or revokes an online key in keys/keys.json (docs/keys.md).
# The passphrase is typed as in ceremony.ps1, in this window only; it decrypts the existing root key, so a typo
# fails the decryption instead of creating anything. Every step is logged (never the passphrase or a private key)
# to %TEMP%\stylistic-key-list.log.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\keys\update-key-list.ps1 (-Rotate <target> | -Revoke <keyId>)
#   [-Root <encrypted root key>]
param([string]$Rotate, [string]$Revoke, [string]$Root = (Join-Path $HOME 'stylistic-root-keys\root.key.pem'))
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'stylistic-key-list.log'
Set-Location (Join-Path $PSScriptRoot '..\..')

function Write-Log([string]$message) {
  Write-Host $message
  Add-Content -Path $log -Value ("{0:u} {1}" -f (Get-Date), $message)
}

if (($Rotate -eq '') -eq ($Revoke -eq '')) { throw 'Pass exactly one of -Rotate <target> or -Revoke <keyId>' }
Set-Content -Path $log -Value ("{0:u} key list update started (rotate: {1}, revoke: {2})" -f (Get-Date), $Rotate, $Revoke)
$passphrase = Read-Host 'Root key passphrase'
Clear-Host
Write-Log 'Passphrase read (not logged). Updating the key list...'

$env:STYLISTIC_ROOT_PASSPHRASE = $passphrase
try {
  $arguments = @('scripts/keys/update-key-list.ts', '--root', $Root)
  if ($Rotate -ne '') { $arguments += @('--rotate', $Rotate) } else { $arguments += @('--revoke', $Revoke) }
  & bun @arguments 2>&1 | ForEach-Object { Write-Log "$_" }
  if ($LASTEXITCODE -ne 0) { Write-Log "The update failed (exit $LASTEXITCODE); the log is $log"; exit $LASTEXITCODE }
} finally {
  Remove-Item Env:STYLISTIC_ROOT_PASSPHRASE -ErrorAction SilentlyContinue
}
Write-Log 'Done. Review and commit keys/keys.json and keys/keys.json.sig; the catalog job publishes them.'

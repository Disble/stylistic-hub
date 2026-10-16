# Keeps Stylistic in every Word session. Word reads a sideloaded add-in only when it shows a document that
# refers to it, so for each new Word session this opens that document read-only and minimized, then closes it.
# Afterwards every document in the session shows the add-in's ribbon button (docs/architecture.md).
param(
  [Parameter(Mandatory)][string]$Document,
  [Parameter(Mandatory)][int]$ParentPid,
  [int]$PollSeconds = 2,
  [int]$MaxAttempts = 15
)
$ErrorActionPreference = 'Stop'
$missing = [System.Reflection.Missing]::Value
$done = 0
$attempts = 0

while ($true) {
  Start-Sleep -Seconds $PollSeconds
  # The hub supervises this script; when the hub is gone there is nobody to serve the add-in.
  if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }
  $word = Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $word -or $word.Id -eq $done) { continue }
  try {
    $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
    # A hidden Word belongs to another program automating it; leave it alone.
    if (-not $app.Visible) { continue }
    # Documents.Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, ..., Visible)
    $trigger = $app.Documents.Open($Document, $false, $true, $false, $missing, $missing, $missing, $missing, $missing, $missing, $missing, $true)
    try { $trigger.ActiveWindow.WindowState = 2 } catch { }
    $trigger.Close(0)
    $done = $word.Id
    $attempts = 0
    Write-Output "loaded Stylistic in Word $($word.Id)"
  } catch {
    # Word rejects calls while it starts or shows a dialog; try again on the next poll, then give up for this session.
    $attempts++
    if ($attempts -ge $MaxAttempts) {
      $done = $word.Id
      $attempts = 0
      Write-Output "gave up on Word $($word.Id): $($_.Exception.Message)"
    }
  }
}

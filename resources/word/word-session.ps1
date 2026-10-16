# Keeps Stylistic in every Word session. Word reads a sideloaded add-in only when it shows a document that
# refers to it, so for each new Word session this creates a document from it, minimized, then closes it unsaved.
# Afterwards every document in the session shows the add-in's ribbon button (docs/architecture.md).
param(
  [Parameter(Mandatory)][string]$Document,
  [Parameter(Mandatory)][int]$ParentPid,
  [int]$PollSeconds = 2,
  [int]$ReportAfter = 15
)
$ErrorActionPreference = 'Stop'
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
    # Documents.Add(Template, NewTemplate, DocumentType, Visible). Opening the file instead would take the place
    # of an untouched blank document the user just started, and closing it would leave Word's window empty.
    $trigger = $app.Documents.Add($Document, $false, 0, $true)
    try { $trigger.ActiveWindow.WindowState = 2 } catch { }
    $trigger.Close(0)
    $done = $word.Id
    $attempts = 0
    Write-Output "loaded Stylistic in Word $($word.Id)"
  } catch {
    # Word rejects calls while it starts or shows a dialog, and joins COM only once it is ready; keep trying on
    # every poll and report once when it takes long.
    $attempts++
    if ($attempts -eq $ReportAfter) { Write-Output "still waiting for Word $($word.Id): $($_.Exception.Message)" }
  } finally {
    foreach ($com in $trigger, $app) {
      if ($com) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($com) }
    }
    $trigger = $null
    $app = $null
  }
}

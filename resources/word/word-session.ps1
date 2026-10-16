# Keeps Stylistic in every Word session. Word reads a sideloaded add-in only when it shows a document that
# refers to it, so for each new Word session this creates a document from it, then closes it unsaved.
# Afterwards every document in the session shows the add-in's ribbon button (docs/architecture.md).
param(
  [Parameter(Mandatory)][string]$Document,
  [Parameter(Mandatory)][int]$ParentPid,
  [int]$PollSeconds = 2,
  [int]$ReportAfter = 15,
  # The add-in's DisplayName, which titles its task pane.
  [string]$PaneTitle = 'Stylistic',
  # The packaged hub has no console, so the script also keeps what it reports in this file.
  [string]$LogFile
)
$ErrorActionPreference = 'Stop'
$done = 0
$waiting = 0
$attempts = 0

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$ui = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$paneCondition = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, $PaneTitle)),
  (New-Object System.Windows.Automation.PropertyCondition($ui::ClassNameProperty, 'MsoWorkPane')))
$closeCondition = New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, 'Close pane')

# Closes the add-in's task panes inside the given windows, through Word's own "Close pane" button, which belongs
# to the dock bar holding the pane. Returns how many it closed.
function Close-Pane([System.Windows.Automation.AutomationElement[]]$Windows) {
  $closed = 0
  foreach ($window in $Windows) {
    foreach ($pane in $window.FindAll($scope::Descendants, $paneCondition)) {
      $bar = $pane
      while ($bar -and $bar.Current.ClassName -ne 'MsoCommandBar') { $bar = $walker.GetParent($bar) }
      $button = if ($bar) { $bar.FindFirst($scope::Descendants, $closeCondition) }
      if ($button) { $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); $closed++ }
    }
  }
  $closed
}

function Get-WordWindow([int]$Id) {
  @($ui::RootElement.FindAll($scope::Children, (New-Object System.Windows.Automation.PropertyCondition($ui::ProcessIdProperty, $Id))))
}

function Write-Log([string]$Message) {
  $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message
  Write-Output $line
  if ($LogFile) { try { Add-Content -Path $LogFile -Value $line } catch { } }
}

if ($LogFile) {
  try { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null; Set-Content -Path $LogFile -Value $null } catch { }
}
Write-Log "watching Word for the hub (process $ParentPid)"

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
    # Wait for one of the user's documents. On Word's start screen a new document would replace the start screen
    # and leave an empty window once closed.
    if ($app.Documents.Count -lt 1) {
      if ($waiting -ne $word.Id) { $waiting = $word.Id; Write-Log "Word $($word.Id) has no document open yet; waiting" }
      continue
    }
    $active = $app.ActiveWindow
    # Stylistic is not loaded in this session yet, so the user cannot have opened its pane: a pane here is one Word
    # restored from an earlier session, and it stays empty.
    $stale = Close-Pane (Get-WordWindow $word.Id)
    # Documents.Add(Template, NewTemplate, DocumentType, Visible). Opening the file instead would take the place
    # of an untouched blank document the user just started. Word shows the new window for about a second.
    $trigger = $app.Documents.Add($Document, $false, 0, $true)
    # The document opens the add-in's task pane, which is what loads the add-in. Closing that pane before the
    # document keeps Word from restoring it in the user's documents next session.
    $triggerWindow = $ui::FromHandle([IntPtr][int]$trigger.ActiveWindow.Hwnd)
    for ($i = 0; $i -lt 30 -and (Close-Pane @($triggerWindow)) -eq 0; $i++) { Start-Sleep -Milliseconds 100 }
    $trigger.Close(0)
    try { $active.Activate() } catch { }
    Start-Sleep -Milliseconds 1500
    $stale += Close-Pane (Get-WordWindow $word.Id)
    $done = $word.Id
    $attempts = 0
    Write-Log "loaded Stylistic in Word $($word.Id) ($($app.Documents.Count) document(s) open, $stale restored pane(s) closed)"
  } catch {
    # Word rejects calls while it starts or shows a dialog, and joins COM only once it is ready; keep trying on
    # every poll and report once when it takes long.
    $attempts++
    if ($attempts -eq $ReportAfter) { Write-Log "still waiting for Word $($word.Id): $($_.Exception.Message)" }
  } finally {
    foreach ($com in $trigger, $active, $app) {
      if ($com) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($com) }
    }
    $trigger = $null
    $active = $null
    $app = $null
  }
}

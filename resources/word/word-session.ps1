# Keeps Stylistic in every Word session. Word reads a sideloaded add-in only when it shows a document that
# refers to it, so for each new Word session this creates a document from it, off screen, then closes it unsaved.
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

# Keeps the trigger's window off screen through stylistic-hook.dll (native/word-hook), loaded into Word by thread
# hooks only while the trigger runs; without the DLL Word shows that window for about a second.
$hookDll = Join-Path $PSScriptRoot 'stylistic-hook.dll'
if (Test-Path $hookDll) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public static class StylisticHook {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibrary(string path);
  [DllImport("kernel32.dll", CharSet = CharSet.Ansi)] static extern IntPtr GetProcAddress(IntPtr module, string name);
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, IntPtr proc, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  // The DLL acts only while this event exists and is set, so it stops if this script dies mid-trigger.
  static readonly EventWaitHandle Trigger = new EventWaitHandle(false, EventResetMode.ManualReset, "Local\\StylisticHubTrigger");

  // One WH_CBT hook per thread of Word: Word shows a document's window from a thread of its own.
  public static List<IntPtr> Arm(string dll, int wordPid) {
    IntPtr module = LoadLibrary(dll);
    if (module == IntPtr.Zero) throw new InvalidOperationException("LoadLibrary failed: " + Marshal.GetLastWin32Error());
    IntPtr proc = GetProcAddress(module, "StylisticCbtProc");
    if (proc == IntPtr.Zero) throw new InvalidOperationException("StylisticCbtProc is not exported");
    var hooks = new List<IntPtr>();
    foreach (System.Diagnostics.ProcessThread thread in System.Diagnostics.Process.GetProcessById(wordPid).Threads) {
      IntPtr hook = SetWindowsHookEx(5, proc, module, (uint)thread.Id);
      if (hook != IntPtr.Zero) hooks.Add(hook);
    }
    if (hooks.Count == 0) throw new InvalidOperationException("no Word thread accepted the hook");
    Trigger.Set();
    return hooks;
  }

  public static void Disarm(List<IntPtr> hooks) {
    Trigger.Reset();
    foreach (IntPtr hook in hooks) UnhookWindowsHookEx(hook);
  }
}
'@
} else {
  $hookDll = $null
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
    $hooks = $null
    if ($hookDll) {
      try { $hooks = [StylisticHook]::Arm($hookDll, $word.Id) }
      catch { Write-Log "cannot keep the trigger off screen, Word will show it: $($_.Exception.Message)"; $hookDll = $null }
    }
    try {
      $trigger = $app.Documents.Add($Document, $false, 0, $true)
      # The document opens the add-in's task pane, which is what loads the add-in. Closing that pane before the
      # document keeps Word from restoring it in the user's documents next session.
      $triggerWindow = $ui::FromHandle([IntPtr][int]$trigger.ActiveWindow.Hwnd)
      $triggerPane = 0
      for ($i = 0; $i -lt 30 -and $triggerPane -eq 0; $i++) {
        $triggerPane = Close-Pane @($triggerWindow)
        if ($triggerPane -eq 0) { Start-Sleep -Milliseconds 100 }
      }
      # Close does not always take the first time: a trigger left open would keep Word running, off screen, after
      # the user closes their documents. Check by name and try again.
      $triggerName = $trigger.Name
      $trigger.Close(0)
      for ($i = 0; $i -lt 20; $i++) {
        $left = @($app.Documents | Where-Object { $_.Name -eq $triggerName })
        if ($left.Count -eq 0) { break }
        if ($i -eq 0) { Write-Log "the trigger $triggerName is still open; closing it again" }
        Start-Sleep -Milliseconds 250
        foreach ($doc in $left) { try { $doc.Close(0) } catch { } }
      }
      if ($left.Count) { Write-Log "could not close the trigger $triggerName" }
    } finally {
      if ($hooks) { [StylisticHook]::Disarm($hooks) }
    }
    try { $active.Activate() } catch { }
    Start-Sleep -Milliseconds 1500
    $stale += Close-Pane (Get-WordWindow $word.Id)
    $done = $word.Id
    $attempts = 0
    Write-Log "loaded Stylistic in Word $($word.Id) ($($app.Documents.Count) document(s) open, $stale restored pane(s) closed, trigger pane $(if ($triggerPane) { 'closed' } else { 'not found' }), $(if ($hooks) { 'off screen' } else { 'on screen' }))"
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

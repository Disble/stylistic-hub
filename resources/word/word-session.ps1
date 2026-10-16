# Keeps Stylistic in every Word session. Word reads a sideloaded add-in only when it shows a document that
# refers to it, so for each new Word session this creates a document from it, off screen, then closes it unsaved.
# Afterwards every document in the session shows the add-in's ribbon button (docs/architecture.md).
#
# One Word session is one WINWORD process. A Word without a window belongs to another program automating it, or is
# stuck closing, and is left alone (odd/tasks/mvp.md L43). Every session is loaded once and the load is verified:
# the add-in's task pane opening inside the trigger document is what proves the add-in started, so a trigger whose
# pane never appears is undone and retried.
param(
  [Parameter(Mandatory)][string]$Document,
  [Parameter(Mandatory)][int]$ParentPid,
  [int]$PollSeconds = 2,
  [int]$ReportAfter = 15,
  # The add-in's DisplayName, which titles its task pane; the pane opening is the proof the add-in loaded.
  [string]$PaneTitle = 'Stylistic',
  # The packaged hub has no console, so the script also keeps what it reports in this file.
  [string]$LogFile,
  # How long one trigger waits for the add-in's task pane before it is undone and tried again.
  [int]$LoadTimeoutSeconds = 20,
  # Trigger attempts per Word session before the loader reports a failure and starts a fresh round.
  [int]$TriggerAttempts = 3,
  # After a session fails a round, how long before the loader tries it again: a backend that was down, or a Word
  # that was busy, should not make the loader hammer Word with trigger documents.
  [int]$RetryAfterMinutes = 5
)
$ErrorActionPreference = 'Stop'
$installed = @{}
$noted = @{}
$nextRound = @{}

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$ui = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$paneCondition = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, $PaneTitle)),
  (New-Object System.Windows.Automation.PropertyCondition($ui::ClassNameProperty, 'MsoWorkPane')))
$closeCondition = New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, 'Close pane')

# The add-in's task panes inside the given windows. The pane is what loads the add-in; Word also restores the pane
# of a previous session, empty, into the user's document, so a pane that exists before the trigger is closed.
function Get-Pane([System.Windows.Automation.AutomationElement[]]$Windows) {
  $panes = @()
  foreach ($window in $Windows) {
    foreach ($pane in $window.FindAll($scope::Descendants, $paneCondition)) { $panes += $pane }
  }
  ,$panes
}

# Closes one pane through Word's own "Close pane" button, which belongs to the dock bar holding it.
function Close-PaneElement([System.Windows.Automation.AutomationElement]$Pane) {
  $bar = $Pane
  while ($bar -and $bar.Current.ClassName -ne 'MsoCommandBar') { $bar = $walker.GetParent($bar) }
  $button = if ($bar) { $bar.FindFirst($scope::Descendants, $closeCondition) }
  if (-not $button) { return $false }
  $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  return $true
}

# Closes the add-in's panes inside the given windows; returns how many it closed.
function Close-Pane([System.Windows.Automation.AutomationElement[]]$Windows) {
  $closed = 0
  foreach ($pane in (Get-Pane $Windows)) { if (Close-PaneElement $pane) { $closed++ } }
  $closed
}

# Word's Application behind one of its windows. GetActiveObject would return whichever Word registered first, which
# may be a hidden one another program automates, or one stuck closing; Word's document window (class _WwG) hands
# out its Window object through the standard accessibility API instead. $null while Word shows no document.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WordWindow {
  delegate bool EnumProc(IntPtr hwnd, IntPtr unused);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr unused);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IDispatch)] out object window);
  const uint OBJID_NATIVEOM = 0xFFFFFFF0;
  static Guid IID_IDispatch = new Guid("00020400-0000-0000-C000-000000000046");

  public static object Of(IntPtr frame) {
    IntPtr document = IntPtr.Zero;
    EnumChildWindows(frame, (hwnd, unused) => {
      var name = new StringBuilder(16);
      GetClassName(hwnd, name, name.Capacity);
      if (name.ToString() != "_WwG") return true;
      document = hwnd;
      return false;
    }, IntPtr.Zero);
    if (document == IntPtr.Zero) return null;
    object window;
    return AccessibleObjectFromWindow(document, OBJID_NATIVEOM, ref IID_IDispatch, out window) == 0 ? window : null;
  }
}
'@

function Get-WordWindow([int]$WordId) {
  @($ui::RootElement.FindAll($scope::Children, (New-Object System.Windows.Automation.PropertyCondition($ui::ProcessIdProperty, $WordId))))
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

# Reports the reason once per Word session, so a session that is simply waiting does not fill the log.
function Write-Once([string]$Key, [string]$Message) {
  if ($noted.ContainsKey($Key)) { return }
  $noted[$Key] = $true
  Write-Log $Message
}

if ($LogFile) {
  try { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null; Set-Content -Path $LogFile -Value $null } catch { }
}
Write-Log "watching Word for the hub (process $ParentPid)"

while ($true) {
  Start-Sleep -Seconds $PollSeconds
  # The hub supervises this script; when the hub is gone there is nobody to serve the add-in.
  if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }
  try {
    $running = @(Get-Process WINWORD -ErrorAction SilentlyContinue)
    foreach ($word in $running) {
      if ($word.MainWindowHandle -eq 0) {
        Write-Once "$($word.Id):hidden" "ignoring Word $($word.Id): it has no window"
        continue
      }
      if ($installed.ContainsKey($word.Id)) { continue }
      if ($nextRound.ContainsKey($word.Id) -and $nextRound[$word.Id] -gt (Get-Date)) { continue }
      $view = $null
      $app = $null
      $trigger = $null
      try {
        $view = [WordWindow]::Of([IntPtr]$word.MainWindowHandle)
        if (-not $view) {
          Write-Once "$($word.Id):unreachable" "Word $($word.Id) shows no document window yet; waiting"
          continue
        }
        $app = $view.Application
        if ($app.Documents.Count -lt 1) {
          Write-Once "$($word.Id):nodocument" "Word $($word.Id) has no document open yet; waiting"
          continue
        }
        # The add-in is not loaded in this session yet, so the user cannot have opened its pane: a pane here is one
        # Word restored from an earlier session, and it stays empty.
        $stale = Close-Pane (Get-WordWindow $word.Id)
        $pane = 0
        $attempt = 0
        while ($attempt -lt $TriggerAttempts) {
          $attempt++
          $hooks = $null
          if ($hookDll) {
            try { $hooks = [StylisticHook]::Arm($hookDll, $word.Id) }
            catch { Write-Log "cannot keep the trigger off screen, Word will show it: $($_.Exception.Message)"; $hookDll = $null }
          }
          try {
            # Documents.Add(Template, NewTemplate, DocumentType, Visible). Opening the file instead would take the
            # place of an untouched blank document the user just started.
            $trigger = $app.Documents.Add($Document, $false, 0, $true)
            $triggerWindow = $ui::FromHandle([IntPtr][int]$trigger.ActiveWindow.Hwnd)
            $deadline = (Get-Date).AddSeconds($LoadTimeoutSeconds)
            $pane = 0
            while ((Get-Date) -lt $deadline -and $pane -eq 0) {
              $pane = @(Get-Pane @($triggerWindow)).Count
              if ($pane -eq 0) { Start-Sleep -Milliseconds 200 }
            }
            # The pane is the add-in's own UI: give it a moment to finish starting before taking it away, then close
            # it inside the trigger, because otherwise Word restores it, empty, in the user's documents next session.
            if ($pane) {
              Start-Sleep -Milliseconds 700
              [void](Close-Pane @($triggerWindow))
            }
            # Close does not always take the first time: a trigger left open would keep Word running, off screen,
            # after the user closes their documents. Check by name and try again.
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
            if ($trigger) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($trigger) }
            $trigger = $null
          }
          if ($pane) { break }
          Write-Log "attempt $attempt of ${TriggerAttempts}: Word $($word.Id) did not show the add-in's task pane in ${LoadTimeoutSeconds}s"
        }
        if (-not $pane) {
          $nextRound[$word.Id] = (Get-Date).AddMinutes($RetryAfterMinutes)
          Write-Log "Word $($word.Id) did not load Stylistic after $TriggerAttempts attempts; trying again in ${RetryAfterMinutes} minutes"
          continue
        }
        try { $view.Activate() } catch { }
        Start-Sleep -Milliseconds 1200
        $stale += Close-Pane (Get-WordWindow $word.Id)
        $installed[$word.Id] = $true
        Write-Log "loaded Stylistic in Word $($word.Id) (attempt $attempt, $($app.Documents.Count) document(s) open, $stale restored pane(s) closed)"
      } catch {
        Write-Once "$($word.Id):error" "cannot load Stylistic in Word $($word.Id) yet: $($_.Exception.Message)"
      } finally {
        foreach ($com in $view, $app) {
          if ($com) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($com) }
        }
      }
    }
  } catch {
    Write-Log "loader error: $($_.Exception.Message)"
  }
}

# Keeps Stylistic in every Word session. Word reads a sideloaded add-in only when it shows a document that
# refers to it, so for each new Word session this creates a document from it, off screen, then closes it unsaved.
# Afterwards every document in the session shows the add-in's ribbon button (docs/architecture.md).
#
# One Word session is one WINWORD process. A Word without a window belongs to another program automating it, or is
# stuck closing, and is left alone (odd/tasks/mvp.md L43). Every session is loaded once, and the loader watches for
# the add-in's task pane opening inside the trigger document: that is its signal that Word started the add-in, not a
# guarantee, because Word also restores that pane into new documents once its own cache is warm (L47). A trigger
# whose pane never appears is undone and retried.
param(
  [Parameter(Mandatory)][string]$Document,
  [Parameter(Mandatory)][int]$ParentPid,
  [int]$PollSeconds = 2,
  [int]$ReportAfter = 15,
  # The add-in's DisplayName, which titles its task pane; the pane opening is the loader's signal that Word loaded it.
  [string]$PaneTitle = 'Stylistic',
  # The packaged hub has no console, so the script also keeps what it reports in this file.
  [string]$LogFile,
  # How long one trigger waits for the add-in's task pane before it is undone and tried again.
  [int]$LoadTimeoutSeconds = 20,
  # Trigger attempts per Word session before the loader reports a failure and starts a fresh round.
  [int]$TriggerAttempts = 3,
  # After a session fails a round, how long before the loader tries it again: a backend that was down, or a Word
  # that was busy, should not make the loader hammer Word with trigger documents.
  [int]$RetryAfterMinutes = 5,
  # How long to keep looking for the add-in's own UI in the user's window after a trigger before calling it failed.
  [int]$PresenceTimeoutSeconds = 20,
  # The names the add-in puts in the window, read from the manifest next to the document when this is empty.
  [string[]]$AddinNames,
  # The hub's port, to tell whether Word asked for the add-in's page at all.
  [int]$HubPort = 3000
)
$ErrorActionPreference = 'Stop'
$installed = @{}
$noted = @{}
$nextRound = @{}
$failedRounds = @{}

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$ui = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$paneCondition = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, $PaneTitle)),
  (New-Object System.Windows.Automation.PropertyCondition($ui::ClassNameProperty, 'MsoWorkPane')))
$closeCondition = New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, 'Close pane')

# What the add-in looks like in a window: the label of its ribbon group and of its button, which its manifest declares.
# Reading them from the manifest next to the document keeps this script from carrying a copy of that text.
function Get-AddinNames([string]$ManifestPath, [string]$DisplayName) {
  $names = @($DisplayName)
  if ($ManifestPath -and (Test-Path -LiteralPath $ManifestPath)) {
    $manifest = Get-Content -Raw -LiteralPath $ManifestPath
    foreach ($pattern in '<DisplayName DefaultValue="([^"]+)"', '<bt:String id="CommandsGroup.Label" DefaultValue="([^"]+)"', '<bt:String id="TaskpaneButton.Label" DefaultValue="([^"]+)"') {
      $value = [regex]::Match($manifest, $pattern).Groups[1].Value
      if ($value) { $names += $value }
    }
  }
  @($names | Where-Object { $_ } | Select-Object -Unique)
}

# Whether the add-in is loaded in this Word session, judged by what the user can see: its own UI in one of the
# windows of that Word. A MsoWorkPane is not that UI: Word creates one from the trigger document's own
# webextensions part, named after the add-in, even when the add-in never starts, so a window that only has the pane
# host is not loaded.
function Test-AddinPresent([int]$WordId) {
  foreach ($window in (Get-WordWindow $WordId)) {
    foreach ($name in $AddinNames) {
      $found = $window.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, $name)))
      foreach ($element in $found) {
        if ($element.Current.ClassName -ne 'MsoWorkPane') { return $true }
      }
    }
  }
  $false
}

# Whether a Word add-in runtime asked the hub for a page during this attempt: Word starts the add-in's WebView2 for a
# document that refers to it, and nothing else on the machine does it under that browser's name.
function Test-PageFetched {
  $fetched = @(Get-NetTCPConnection -RemotePort $HubPort -State Established -ErrorAction SilentlyContinue |
    Where-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName -like 'msedgewebview2*' })
  $fetched.Count -gt 0
}

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
if (-not $AddinNames) { $AddinNames = Get-AddinNames (Join-Path (Split-Path -Parent $Document) 'manifest.xml') $PaneTitle }

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
Write-Log "the add-in's UI is looked for as: $($AddinNames -join ', ')"

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
        if (Test-AddinPresent $word.Id) {
          $installed[$word.Id] = $true
          Write-Log "Stylistic is already in a window of Word $($word.Id); no trigger needed"
          continue
        }
        $pane = 0
        $loaded = $false
        $attempt = 0
        while ($attempt -lt $TriggerAttempts) {
          $attempt++
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
            if ($trigger) {
              # Whatever went wrong, the trigger must not outlive the attempt: with the hook off, a document Word
              # still has open keeps a window the user would see.
              try { $trigger.Close(0) } catch { }
              [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($trigger)
            }
            $trigger = $null
          }
          # The pane only says Word created a host for it. What the user gets is the add-in's own UI in a window of
          # this Word, so that is what is waited for and what decides the verdict.
          $deadline = (Get-Date).AddSeconds($PresenceTimeoutSeconds)
          $loaded = Test-AddinPresent $word.Id
          while (-not $loaded -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 500
            $loaded = Test-AddinPresent $word.Id
          }
          if ($loaded) { break }
          $fetched = Test-PageFetched
          $why = if ($pane) {
            "the trigger's task pane opened, but the add-in's UI is not in the window"
          } elseif ($fetched) {
            "Word asked the hub for the add-in's page, but the add-in's UI is not in the window"
          } else {
            "Word started nothing: no task pane and no request for the add-in's page"
          }
          Write-Log "attempt $attempt of ${TriggerAttempts}: $why (Word $($word.Id))"
        }
        if (-not $loaded) {
          $failedRounds[$word.Id] = [int]$failedRounds[$word.Id] + 1
          $nextRound[$word.Id] = (Get-Date).AddMinutes($RetryAfterMinutes)
          Write-Log "Stylistic is not loaded in Word $($word.Id) after $TriggerAttempts attempts; trying again in ${RetryAfterMinutes} minutes"
          continue
        }
        try { $view.Activate() } catch { }
        Start-Sleep -Milliseconds 1200
        $stale += Close-Pane (Get-WordWindow $word.Id)
        $installed[$word.Id] = $true
        Write-Log "loaded Stylistic in Word $($word.Id) (attempt $attempt, $($app.Documents.Count) document(s) open, $stale restored pane(s) closed)"
      } catch {
        # A Word that is busy or starting rejects calls; that deserves another try on the next poll. One that keeps
        # rejecting them does not, and must not make every poll create another document.
        $failedRounds[$word.Id] = [int]$failedRounds[$word.Id] + 1
        Write-Log "cannot load Stylistic in Word $($word.Id) yet (round $($failedRounds[$word.Id])): $($_.Exception.Message)"
        if ($failedRounds[$word.Id] -ge 3) { $nextRound[$word.Id] = (Get-Date).AddMinutes($RetryAfterMinutes) }
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

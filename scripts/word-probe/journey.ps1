# Probe (not part of the app): measures what the Word session loader does in a real Word session — whether
# Stylistic loads and whether Word shows a window for the trigger document. Run it with no visible Word open; it
# starts its own Word on a scratch document and closes it afterwards. A windowless Word left behind by another
# program is tolerated and reported, because that is the case the loader has to survive (odd/tasks/mvp.md L43).
#
#   powershell -NoProfile -File scripts/word-probe/journey.ps1 -Loader resources/word/word-session.ps1 `
#     -Trigger "C:\Users\<you>\AppData\Local\Programs\stylistic-hub\resources\addin\Stylistic.docx" -Runs 3
#
# -Windowless starts a hidden Word first, so the loader has to pick the user's own Word.
# -StartScreen shows Word's start screen and opens the scratch document while the loader watches: the case where
# Word creates a frame instead of reusing the hidden one it keeps ready (L42/L43).
param(
  [Parameter(Mandatory)][string]$Loader,
  [Parameter(Mandatory)][string]$Trigger,
  [int]$Runs = 1,
  [int]$Seconds = 18,
  [switch]$Windowless,
  [switch]$StartScreen,
  [switch]$KeepWord,
  # The ribbon check reads Word's UI through UI Automation, which can block while the loader drives Word; -SkipButton
  # leaves the loader's own log as the load signal.
  [switch]$SkipButton,
  [string]$OutDir
)
$ErrorActionPreference = 'Stop'
# $PSScriptRoot is not set while parameter defaults bind, so the default path is resolved here.
if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot 'out' }

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ProbeWin {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  public struct RECT { public int Left, Top, Right, Bottom; }

  /** Every top-level Word frame: "pid,handle,visible,minimized,left,top,right,bottom,title". Word's hidden frames
   *  sit at -32000, the hook's off screen convention. */
  public static List<string> Windows() {
    var found = new List<string>();
    EnumWindows((h, p) => {
      uint owner; GetWindowThreadProcessId(h, out owner);
      var cls = new StringBuilder(16); GetClassNameW(h, cls, 16);
      if (cls.ToString() != "OpusApp") return true;
      var title = new StringBuilder(256); GetWindowTextW(h, title, 256);
      RECT r; GetWindowRect(h, out r);
      found.Add(string.Format("{0},{1},{2},{3},{4},{5},{6},{7},{8}", owner, h, IsWindowVisible(h) ? 1 : 0,
        IsIconic(h) ? 1 : 0, r.Left, r.Top, r.Right, r.Bottom, title.ToString()));
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

$ui = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$buttonCondition = New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, 'Show Task Pane')

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# A frame as a record, or $null.
function Get-Frame([string]$Pattern) {
  foreach ($line in [ProbeWin]::Windows()) {
    $parts = $line.Split(',')
    if ($parts[8] -like $Pattern) {
      return [pscustomobject]@{ Pid = [int]$parts[0]; Handle = $parts[1]; Visible = [int]$parts[2]; Title = $parts[8] }
    }
  }
  return $null
}

# The add-in's ribbon button, which Word shows in the user's window once the session has loaded it.
function Test-Addin([string]$Handle, [int]$TimeoutMs = 8000) {
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  do {
    try {
      $window = $ui::FromHandle([IntPtr][int]$Handle)
      if ($window.FindFirst($scope::Descendants, $buttonCondition)) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  return $false
}

# A plain document for the user's side of the journey; the loader must never touch it.
function New-Scratch([string]$Path) {
  if (Test-Path $Path) { return }
  $app = New-Object -ComObject Word.Application
  $app.Visible = $false
  try {
    $doc = $app.Documents.Add()
    $doc.Content.Text = 'Probe document. The loader must leave this text and this window alone.'
    $doc.SaveAs2($Path, 16)
    $doc.Close(0)
  } finally {
    $app.Quit()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
  }
}

# Ends the Word this run started, and only that one. The probe used to stop every Word with a window, which kills
# the user's own Word if they open one while the probe runs and leaves Word offering to recover the probe document
# at the next start. It closes the scratch document through Word first, so Word has nothing to recover, and falls
# back to the one process that owns the frame the probe was measuring.
function Close-ProbeWord([int]$WordId, [string]$Name) {
  try {
    $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
    if (@($app.Documents | Where-Object { $_.Name -eq $Name }).Count) {
      foreach ($doc in @($app.Documents | Where-Object { $_.Name -eq $Name })) { try { $doc.Close(0) } catch { } }
      $app.Quit(0)
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
      Start-Sleep -Seconds 2
    }
  } catch { }
  $left = Get-Process -Id $WordId -ErrorAction SilentlyContinue
  if ($left) {
    # It ignored the quit: stop this process only, never every Word on the machine.
    Stop-Process -Id $WordId -Force -ErrorAction SilentlyContinue
  }
}

$scratch = Join-Path $OutDir 'scratch.docx'
New-Scratch $scratch
$name = Split-Path -Leaf $scratch

$foreignTitles = @()
foreach ($line in [ProbeWin]::Windows()) {
  $parts = $line.Split(',')
  if ($parts[8] -notlike "*$name*") { $foreignTitles += $parts[8] }
}
if ($foreignTitles.Count) { throw "Close Word first: $($foreignTitles -join ' | ')." }
$before = @([ProbeWin]::Windows() | ForEach-Object { $_.Split(',')[0] } | Sort-Object -Unique)
$windowlessWords = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -eq 0 })
if ($windowlessWords.Count) { Write-Output "note: windowless Word already running (pid $($windowlessWords.Id -join ', '))" }

$report = @()
for ($runIndex = 1; $runIndex -le $Runs; $runIndex++) {
  # Word's start screen has no document; the loader has to wait for the user's document, then load.
  if ($StartScreen) {
    Start-Process winword.exe -ArgumentList '/n' | Out-Null
    Start-Sleep -Seconds 4
  } else {
    # /n asks for a new instance: Word hands a plain launch to a Word that is already running, including a windowless
    # one left behind by a session the user closed, and then nothing appears to measure.
    Start-Process winword.exe -ArgumentList @('/n', "`"$scratch`"") | Out-Null
  }

  $target = $null
  $deadline = (Get-Date).AddSeconds(25)
  while (-not $target -and (Get-Date) -lt $deadline) {
    if ($StartScreen) {
      $target = Get-Frame '*Word'
    } else {
      $target = Get-Frame "*$name*"
    }
    if (-not $target) { Start-Sleep -Milliseconds 300 }
  }
  if (-not $target) { throw "run ${runIndex}: Word did not show a frame" }
  Write-Output "run ${runIndex}: Word pid $($target.Pid) title '$($target.Title)'"
  Start-Sleep -Seconds 3 # the loader polls every 2 s
  # Word can show the add-in's button from its own ribbon cache, so the button before the trigger says whether this
  # session really had to load the add-in.
  $before = if ($SkipButton) { 'skipped' } else { Test-Addin $target.Handle 2500 }

  $log = Join-Path $OutDir "run-$runIndex-loader.log"
  $loaderProcess = Start-Process powershell.exe -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Resolve-Path $Loader).Path,
    '-Document', (Resolve-Path $Trigger).Path, '-ParentPid', $PID, '-LogFile', $log)

  # Track what the user could see while the loader works, every 40 ms until the time is up.
  $samples = New-Object System.Collections.Generic.List[string]
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $opened = $false
  while ($watch.Elapsed.TotalSeconds -lt $Seconds) {
    foreach ($line in [ProbeWin]::Windows()) {
      $parts = $line.Split(',')
      # The title goes first: it may contain commas, the numeric fields cannot.
      if ([int]$parts[0] -eq $target.Pid) { $samples.Add("$($watch.ElapsedMilliseconds);$($parts[8]);$($parts[1..7] -join ',')") }
    }
    # On the start screen the user opens their document while the loader watches.
    if ($StartScreen -and -not $opened -and $watch.Elapsed.TotalSeconds -gt 4) {
      $opened = $true
      Start-Process winword.exe -ArgumentList @('/n', "`"$scratch`"") | Out-Null
    }
    Start-Sleep -Milliseconds 40
  }
  Stop-Process -Id $loaderProcess.Id -Force -ErrorAction SilentlyContinue
  $watch.Stop()

  # On the start screen the frame that showed it disappears once the user's document opens, so the ribbon is read
  # from the user's own document window, which is what the user would look at.
  $userFrame = Get-Frame "*$name*"
  $loaded = if ($SkipButton) { 'skipped' } else { Test-Addin $(if ($userFrame) { $userFrame.Handle } else { $target.Handle }) }
  # A frame the user should see is their own document window (its title carries the scratch document's name) and,
  # on the start screen, the frame that showed it; every other frame of the Word process must stay off screen.
  $frames = @{}
  $onScreenMs = 0
  foreach ($sample in $samples) {
    $head = $sample.Split(';')
    $title = $head[1]
    $parts = $head[2].Split(',')
    $handle = $parts[0]
    $visible = [int]$parts[1]
    $iconic = [int]$parts[2]
    $left = [int]$parts[3]
    $top = [int]$parts[4]
    if (-not $frames.ContainsKey($handle)) { $frames[$handle] = @{ visible = 0; onScreen = 0; title = $title } }
    $frames[$handle].title = $title
    if ($visible) { $frames[$handle].visible++ }
    if ($visible -and -not $iconic -and $left -gt -10000 -and $top -gt -10000) {
      $frames[$handle].onScreen++
      if ($handle -ne $target.Handle -and $title -notlike "*$name*") { $onScreenMs += 40 }
    }
  }
  $extra = @($frames.Keys | Where-Object { $_ -ne $target.Handle -and $frames[$_].title -notlike "*$name*" })
  $extraVisible = @($extra | Where-Object { $frames[$_].visible -gt 0 })
  $verdict = 'run {0}: before={1} loaded={2} frames={3} extraFrames={4} extraVisible={5} extraOnScreen={6}ms' -f `
    $runIndex, $before, $loaded, $frames.Count, $extra.Count, $extraVisible.Count, $onScreenMs
  Write-Output $verdict
  Get-Content $log -ErrorAction SilentlyContinue | ForEach-Object { Write-Output "    $_" }
  $report += $verdict
  $report += (Get-Content $log -ErrorAction SilentlyContinue)
  # When was each frame the user should not see on screen, so a flash can be attributed to a moment.
  $spans = @()
  foreach ($key in $frames.Keys) {
    if ($key -eq $target.Handle -or $frames[$key].title -like "*$name*") { continue }
    $stamps = @($samples | Where-Object { ($_ -split ';')[2].Split(',')[0] -eq $key -and ($_ -split ';')[2].Split(',')[1] -eq '1' -and ($_ -split ';')[2].Split(',')[2] -eq '0' -and [int](($_ -split ';')[2].Split(',')[3]) -gt -10000 -and [int](($_ -split ';')[2].Split(',')[4]) -gt -10000 } | ForEach-Object { [int]($_ -split ';')[0] })
    if (-not $stamps.Count) { continue }
    $first = $stamps[0]; $last = $stamps[-1]
    $spans += ("$key '$($frames[$key].title)' shown $first..${last}ms ($($stamps.Count) samples)")
  }
  $report += '  on screen: ' + ($spans -join ' | ')
  $report += '  frames: ' + (($frames.Keys | ForEach-Object { "$_ `"$($frames[$_].title)`" visible=$($frames[$_].visible) onScreen=$($frames[$_].onScreen)" }) -join ' | ')
  $report += '  samples: ' + ($samples -join ' | ')
  if (-not $KeepWord) { Close-ProbeWord $target.Pid $name }
  Start-Sleep -Seconds 3
}

# The probe document is not left behind: a document the user never asked for must not be sitting in the repo, and
# Word reopens whatever it was showing when it died.
if (-not $KeepWord) { Remove-Item -Force -ErrorAction SilentlyContinue $scratch, (Join-Path $OutDir ('~$' + $name.Substring(1))) }

Set-Content -Path (Join-Path $OutDir 'journey.txt') -Value $report
Write-Output '--- journey.txt written ---'

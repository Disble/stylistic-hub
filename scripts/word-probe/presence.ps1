# Answers the only question that matters: is the add-in in the window the user looks at?
#
# The journey probe measured window frames and trusted the loader's own log, and every run whose output was used ran
# with -SkipButton, so nothing ever checked the add-in. This does only that check, with two independent signals:
#
#   1. UI Automation over the visible document window, for the add-in's own UI. The same pass counts other add-ins the
#      user has (Adobe Acrobat, QuillBot, Easy Code Formatter), which is the control: when those are found and Stylistic
#      is not, its absence is real and not a limitation of the measurement.
#   2. Files under Word's WebView2 profile touched during the run. Word fetches the add-in's page from the hub, so a
#      fresh write naming the hub's origin is proof the page loaded, whatever the panes say.
#
# It starts its own Word on a plain document it deletes afterwards, and it closes only that Word, through Word, never
# with Stop-Process over every Word on the machine.
#
#   powershell -NoProfile -File scripts/word-probe/presence.ps1 -Loader resources/word/word-session.ps1 `
#     -Trigger <installed>/resources/addin/Stylistic.docx
#   powershell -NoProfile -File scripts/word-probe/presence.ps1 -NoLoader     # baseline: no trigger at all
param(
  [string]$Loader,
  [string]$Trigger,
  [string]$OutDir,
  [int]$Seconds = 45,
  [string]$PaneTitle = 'Stylistic',
  # Names the add-in's manifest puts in the ribbon, and other add-ins the user has, as the measurement's control.
  [string[]]$AddinNames = @($PaneTitle, 'Commands Group', 'Show Task Pane'),
  [string[]]$ControlNames = @('Adobe Acrobat', 'QuillBot', 'Easy Code Formatter'),
  [switch]$NoLoader,
  [switch]$KeepWord,
  # A plain .docx (no add-in inside it) for the run's own document window. Word can copy one it has open, so this
  # needs no COM and cannot attach to a Word that is already running.
  [string]$PlainSource
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
# Reads a Word instance's own window object, which is how this run's Word is told from another one: GetActiveObject
# returns whichever Word registered first, and with a second Word running that is not this run's, which is how a run
# used to leave both a Word and its document behind.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ProbeWord {
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
$ui = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]

if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot 'out' }
if (-not $Loader) { $Loader = Join-Path (Split-Path -Parent $PSScriptRoot) 'word\word-session.ps1' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# The hub serves the add-in's page from this origin; Word fetches it when the add-in really starts.
$origin = 'localhost:3000'
$addinDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Office\16.0\Wef\webview2'

function Get-Frame([string]$Title) {
  $found = $null
  foreach ($process in @(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })) {
    $element = $ui::FromHandle([IntPtr]$process.MainWindowHandle)
    if ($element -and $element.Current.Name -like $Title) {
      $found = [pscustomobject]@{ Pid = $process.Id; Handle = [int]$process.MainWindowHandle; Title = $element.Current.Name }
    }
  }
  $found
}

# What the add-in's UI looks like in one window, next to add-ins Word is known to have.
function Get-Presence([int]$Handle) {
  $window = $ui::FromHandle([IntPtr]$Handle)
  $lines = @()
  foreach ($name in $AddinNames) {
    $condition = New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, $name)
    $lines += "$name=$(($window.FindAll($scope::Descendants, $condition)).Count)"
  }
  foreach ($name in $ControlNames) {
    $condition = New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, $name)
    $lines += "$($name -replace ' ','')=$(($window.FindAll($scope::Descendants, $condition)).Count)"
  }
  $tab = New-Object System.Windows.Automation.PropertyCondition($ui::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
  $tabs = @($window.FindAll($scope::Descendants, $tab) | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
  "  ribbon: " + ($lines -join ' ')
  "  tabs: " + ($tabs -join ' | ')
}

# Files of Word's add-in profile touched since $Since, naming the hub's origin.
function Get-ProfileWrites([datetime]$Since) {
  $hits = @()
  foreach ($file in @(Get-ChildItem -Path $addinDir -Recurse -File -ErrorAction SilentlyContinue)) {
    if ($file.LastWriteTime -lt $Since) { continue }
    if ($file.Length -gt 4MB) { continue }
    try { if (Select-String -LiteralPath $file.FullName -Pattern $origin -Quiet -ErrorAction Stop) { $hits += $file.FullName } } catch { }
  }
  $hits
}

# The run's document: a minimal .docx this script writes itself, so the measurement needs no Word, no COM (which
# with another Word already running binds to that one) and no fixture left on disk. Override -PlainSource to use a
# real document instead.
function New-PlainDocument([string]$Path) {
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  $parts = [ordered]@{
    '[Content_Types].xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    '_rels/.rels' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    'word/document.xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">Presence check. A plain document with no add-in inside it.</w:t></w:r></w:p></w:body></w:document>'
  }
  $zip = [System.IO.Compression.ZipFile]::Open($Path, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($entry in $parts.Keys) {
      $writer = New-Object System.IO.StreamWriter($zip.CreateEntry($entry).Open(), (New-Object System.Text.UTF8Encoding($false)))
      try { $writer.Write($parts[$entry]) } finally { $writer.Dispose() }
    }
  } finally { $zip.Dispose() }
}

$scratch = Join-Path $OutDir "presence-$PID.docx"
if (Test-Path $scratch) { Remove-Item -Force $scratch }
if ($PlainSource) {
  if (-not (Test-Path $PlainSource)) { throw "No plain document at $PlainSource." }
  Copy-Item -Path $PlainSource -Destination $scratch -Force
} else {
  New-PlainDocument $scratch
}
$name = Split-Path -Leaf $scratch
$stem = [IO.Path]::GetFileNameWithoutExtension($scratch)

# Any other Word *with a window* is a Word this probe must not touch. A windowless Word is ignored on purpose: Word
# often leaves one behind after its window closes, and its COM registration would swallow the launch below.
$others = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
if ($others.Count) { throw "Close Word first: pid $($others.Id -join ', ') still has a window." }
$before = (Get-Date).AddSeconds(-2)
# /n asks for a new instance: without it Word hands the request to a Word that is already running, which is how a
# measurement ends up watching a process nobody can see.
Start-Process winword.exe -ArgumentList @('/n', "`"$scratch`"") | Out-Null
$target = $null
$deadline = (Get-Date).AddSeconds(25)
while (-not $target -and (Get-Date) -lt $deadline) {
  $target = Get-Frame "*$stem*"
  if (-not $target) { Start-Sleep -Milliseconds 300 }
}
if (-not $target) { throw 'Word did not show the document window' }
Write-Output "Word pid $($target.Pid) on '$name'"

Start-Sleep -Seconds 4
Write-Output '--- before the loader ---'
Get-Presence $target.Handle

$loaderProcess = $null
# Whatever the panes say, a connection to the hub's port from a WebView2 process is the page being fetched.
$connections = New-Object System.Collections.Generic.List[string]
if (-not $NoLoader) {
  $log = Join-Path $OutDir 'presence-loader.log'
  $loaderProcess = Start-Process powershell.exe -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Resolve-Path $Loader).Path,
    '-Document', (Resolve-Path $Trigger).Path, '-ParentPid', $PID, '-LogFile', $log,
    # One attempt with short waits, so the loader's verdict lands inside this observation window and this probe
    # measures one trigger instead of the loader's retry policy.
    '-TriggerAttempts', '1', '-LoadTimeoutSeconds', '8', '-PresenceTimeoutSeconds', '8')
  Write-Output "loader started with -Document $((Resolve-Path $Trigger).Path)"
}
Start-Sleep -Seconds $Seconds
foreach ($connection in @(Get-NetTCPConnection -RemotePort 3000 -State Established -ErrorAction SilentlyContinue)) {
  $owner = (Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue).ProcessName
  $connections.Add("$owner (pid $($connection.OwningProcess))")
}
if ($loaderProcess) { Stop-Process -Id $loaderProcess.Id -Force -ErrorAction SilentlyContinue }

Write-Output '--- after the loader ---'
Get-Presence $target.Handle
$writes = Get-ProfileWrites $before
Write-Output "--- connections to the hub's port during this run: $(($connections | Sort-Object -Unique) -join ', ') ---"
Write-Output "--- Word's add-in profile wrote about $origin during this run: $($writes.Count) file(s) ---"
foreach ($file in ($writes | Select-Object -First 5)) { Write-Output "  $file" }
if ($loaderProcess) { Get-Content (Join-Path $OutDir 'presence-loader.log') -ErrorAction SilentlyContinue | ForEach-Object { Write-Output "loader: $_" } }

if (-not $KeepWord) {
  try {
    $window = [ProbeWord]::Of([IntPtr]$target.Handle)
    if ($window) {
      $app = $window.Application
      $app.Quit(0)
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($window)
    }
  } catch { }
  if (Get-Process -Id $target.Pid -ErrorAction SilentlyContinue) { Stop-Process -Id $target.Pid -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  foreach ($file in @(Get-ChildItem -Path $OutDir -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*$stem*" -or $_.Name -like '~$*' })) {
    for ($i = 0; $i -lt 5; $i++) {
      try { Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop; break } catch { Start-Sleep -Seconds 1 }
    }
  }
  $visible = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*$stem*" })
  if ($visible.Count) { Write-Output "LEFT OPEN: Word $($visible.Id -join ', ') still shows $stem.docx" } else { Write-Output "closed: no Word window shows $stem.docx" }
}

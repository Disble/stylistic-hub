# Removes what the Word probes left behind: Word instances that hold only probe documents, and those documents.
#
# The probes leaked both. A leaked Word keeps the add-in runtime's WebView2 user-data folder in use, so a later
# session in another Word cannot start the add-in, and a leaked document sits in the repo with its ~$ lock file. This
# never touches a Word that holds anything else: it reads a Word's open documents through its own window object and
# reports the instance instead of ending it.
#
#   powershell -NoProfile -File scripts/word-probe/cleanup.ps1            # report only
#   powershell -NoProfile -File scripts/word-probe/cleanup.ps1 -Apply     # end the probe-only instances and delete
param([switch]$Apply, [string]$OutDir, [string[]]$Mine = @('presence-*', 'scratch.docx'))
$ErrorActionPreference = 'Stop'
if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot 'out' }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WordWindow2 {
  delegate bool EnumProc(IntPtr hwnd, IntPtr unused);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr unused);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IDispatch)] out object window);
  const uint OBJID_NATIVEOM = 0xFFFFFFF0;
  static Guid IID_IDispatch = new Guid("00020400-0000-0000-C000-000000000046");

  // The Word Window object of a document window, which is how one Word instance is told from another without
  // GetActiveObject returning whichever instance registered first.
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

function Test-Mine([string]$Name) {
  foreach ($pattern in $Mine) { if ($Name -like $pattern) { return $true } }
  $false
}

# What one Word holds, read from its own window object; $null when the instance shows no document window.
function Get-Documents([IntPtr]$Frame) {
  try {
    $window = [WordWindow2]::Of($Frame)
    if (-not $window) { return $null }
    $app = $window.Application
    $names = @($app.Documents | ForEach-Object { $_.Name })
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($window)
    return $names
  } catch { return $null }
}

$ended = 0
foreach ($word in @(Get-Process WINWORD -ErrorAction SilentlyContinue)) {
  if ($word.MainWindowHandle -eq 0) {
    Write-Output "word $($word.Id): no window, left alone (a Word the user closed may still hold work)"
    continue
  }
  $documents = Get-Documents ([IntPtr]$word.MainWindowHandle)
  if ($null -eq $documents) {
    Write-Output "word $($word.Id): cannot read its documents, left alone"
    continue
  }
  if ($documents.Count -eq 0) {
    Write-Output "word $($word.Id): no documents open"
  }
  $foreign = @($documents | Where-Object { -not (Test-Mine $_) })
  if ($foreign.Count) {
    Write-Output "word $($word.Id): holds $($documents -join ', ') -> leaving it alone"
    continue
  }
  if ($documents.Count -eq 0) {
    Write-Output "word $($word.Id): empty Word left by a probe"
    if ($Apply) { Stop-Process -Id $word.Id -Force -ErrorAction SilentlyContinue; $ended++ }
    continue
  }
  Write-Output "word $($word.Id): holds only probe documents ($($documents -join ', '))"
  if ($Apply) {
    try {
      $window = [WordWindow2]::Of([IntPtr]$word.MainWindowHandle)
      $app = $window.Application
      $app.Quit(0)
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
      Start-Sleep -Seconds 2
    } catch { }
    if (Get-Process -Id $word.Id -ErrorAction SilentlyContinue) { Stop-Process -Id $word.Id -Force -ErrorAction SilentlyContinue }
    $ended++
  }
}

Start-Sleep -Seconds 1
$files = @(Get-ChildItem -Path $OutDir -File -Force -ErrorAction SilentlyContinue | Where-Object { (Test-Mine $_.Name) -or $_.Name -like '~$*' })
if ($Apply) {
  foreach ($file in $files) {
    for ($i = 0; $i -lt 5; $i++) {
      try { Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop; break } catch { Start-Sleep -Seconds 1 }
    }
  }
  $left = @(Get-ChildItem -Path $OutDir -File -Force -ErrorAction SilentlyContinue | Where-Object { (Test-Mine $_.Name) -or $_.Name -like '~$*' })
  Write-Output "ended $ended Word instance(s); probe files left: $($left.Count)"
} else {
  Write-Output "would end probe-only Word instances and delete $($files.Count) file(s); run with -Apply"
  foreach ($file in $files) { Write-Output "  $($file.Name)" }
}

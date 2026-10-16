# Probe (not part of the app): reports why the loader's native binding to the user's Word window does or does not
# work. Usage: powershell -NoProfile -File scripts/word-probe/window-binding.ps1 -WordPid <pid>
param([Parameter(Mandatory)][int]$WordPid)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class WordWindowProbe {
  delegate bool EnumProc(IntPtr hwnd, IntPtr unused);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr unused);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder name, int size);
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IDispatch)] out object window);
  const uint OBJID_NATIVEOM = 0xFFFFFFF0;
  static Guid IID_IDispatch = new Guid("00020400-0000-0000-C000-000000000046");

  public static string Report(IntPtr frame) {
    var log = new StringBuilder();
    var classes = new List<string>();
    IntPtr document = IntPtr.Zero;
    EnumChildWindows(frame, (hwnd, unused) => {
      var name = new StringBuilder(64);
      GetClassName(hwnd, name, name.Capacity);
      classes.Add(name.ToString());
      if (name.ToString() != "_WwG") return true;
      document = hwnd;
      return false;
    }, IntPtr.Zero);
    log.AppendLine("frame=" + frame + " children=" + classes.Count + " [" + string.Join(",", classes.ToArray()) + "]");
    if (document == IntPtr.Zero) { log.AppendLine("no _WwG child"); return log.ToString(); }
    log.AppendLine("document window=" + document);
    object window;
    int hr = AccessibleObjectFromWindow(document, OBJID_NATIVEOM, ref IID_IDispatch, out window);
    log.AppendLine("AccessibleObjectFromWindow hr=0x" + hr.ToString("X8") + " object=" + (window == null ? "null" : window.GetType().FullName));
    if (window == null) return log.ToString();
    try {
      object application = window.GetType().InvokeMember("Application", System.Reflection.BindingFlags.GetProperty,
        null, window, null);
      log.AppendLine("window.Application=" + (application == null ? "null" : application.GetType().FullName));
    } catch (Exception error) {
      log.AppendLine("Application threw: " + error.GetType().Name + ": " + error.Message);
    }
    return log.ToString();
  }
}
'@

$frames = New-Object System.Collections.Generic.List[System.IntPtr]
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$ui = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
foreach ($window in $ui::RootElement.FindAll($scope::Children, (New-Object System.Windows.Automation.PropertyCondition($ui::ProcessIdProperty, $WordPid)))) {
  $frames.Add([IntPtr][int]$window.Current.NativeWindowHandle)
}
Write-Output "top-level windows of pid ${WordPid}: $($frames.Count)"
foreach ($frame in $frames) { Write-Output ([WordWindowProbe]::Report($frame)) }

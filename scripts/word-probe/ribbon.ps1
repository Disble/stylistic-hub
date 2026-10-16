# Answers one question the loader's log cannot: does the user's Word actually show the add-in?
#
# The loader reports a load when the add-in's task pane opens inside its own trigger document. That is a signal from
# a document the user never sees, so it says nothing about the ribbon group or the pane in the window the user has in
# front of them. This reads that window once, through UI Automation, and prints what Word is showing.
#
#   pwsh -File scripts/word-probe/ribbon.ps1                 # the newest Word with a window
#   pwsh -File scripts/word-probe/ribbon.ps1 -Pid 24100      # a specific Word
#
# One pass only: a second client polling Word would slow Word's own window handling (see the notes in journey.ps1).
param([int]$WordPid = 0, [string]$PaneTitle = 'Stylistic')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$ui = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]

if (-not $WordPid) {
  $word = Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } |
    Sort-Object StartTime -Descending | Select-Object -First 1
  if (-not $word) { Write-Output 'no Word with a window is running'; exit 1 }
  $WordPid = $word.Id
}
$window = $ui::FromHandle([IntPtr](Get-Process -Id $WordPid).MainWindowHandle)
if (-not $window) { Write-Output "Word ${WordPid}: no automation element"; exit 1 }
Write-Output "Word ${WordPid}: $($window.Current.Name)"

$tabs = $window.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($ui::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)))
Write-Output "tabs: $(($tabs | ForEach-Object { $_.Current.Name }) -join ' | ')"

# Word titles the add-in's pane with its DisplayName and hosts it in a MsoWorkPane dock bar.
$panes = $window.FindAll($scope::Descendants, (New-Object System.Windows.Automation.AndCondition(
      (New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, $PaneTitle)),
      (New-Object System.Windows.Automation.PropertyCondition($ui::ClassNameProperty, 'MsoWorkPane')))))
Write-Output "panes titled '$PaneTitle': $($panes.Count)"
foreach ($pane in $panes) {
  $parent = $pane
  for ($i = 0; $i -lt 6 -and $parent; $i++) { $parent = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($parent) }
  Write-Output "  pane offscreen=$($pane.Current.IsOffscreen) class=$($pane.Current.ClassName)"
}

# The manifest puts a group with a button in the HOME tab; Word shows it only when its ribbon knows the add-in.
$names = @($PaneTitle, 'Commands Group', 'Show Task Pane')
foreach ($name in $names) {
  $found = $window.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, $name)))
  $kinds = ($found | ForEach-Object { "$($_.Current.ControlType.ProgrammaticName)/offscreen=$($_.Current.IsOffscreen)" }) -join ', '
  Write-Output "'$name': $($found.Count)$(if ($found.Count) { " -> $kinds" })"
}

# The built-in Add-ins group is where Word lists a sideloaded add-in it knows but is not showing.
$addins = $window.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, 'Add-ins')))
Write-Output "elements named 'Add-ins': $($addins.Count)"

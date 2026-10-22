# הדלקת קלוד, מסלול "מהמחשב": שומר על המחשב ער עד השליחה הבאה (אם הוגדר).
# רץ ברקע מהכניסה ל-Windows, קורא את pc.json בכל חצי דקה, ויוצא כשאין תזמונים או שהאפשרות כבויה.
# על סוללה מתחת לסף שנבחר: מפסיק לשמור ער, וחוזר כשמחברים לחשמל.
$ErrorActionPreference = 'SilentlyContinue'
$cfgFile = Join-Path (Join-Path $env:APPDATA 'ClaudeWake') 'pc.json'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class CwPower { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f); }
'@
$ES_CONTINUOUS = [uint32]2147483648; $ES_SYSTEM = [uint32]1; $ES_DISPLAY = [uint32]2

function Next-Due($cfg) {
  $now = Get-Date; $best = $null
  foreach ($s in @($cfg.schedules)) {
    if (-not $s.enabled) { continue }
    $hm = $s.time -split ':'
    for ($d = 0; $d -le 7; $d++) {
      $day = $now.Date.AddDays($d)
      if (@($s.days) -notcontains [int]$day.DayOfWeek) { continue }
      $t = $day.AddHours([int]$hm[0]).AddMinutes([int]$hm[1])
      if ($t -gt $now.AddMinutes(-3)) { if ($best -eq $null -or $t -lt $best) { $best = $t }; break }
    }
  }
  return $best
}

while ($true) {
  if (-not (Test-Path $cfgFile)) { break }
  $cfg = Get-Content $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $cfg.keepAwake) { break }
  $next = Next-Due $cfg
  if ($next -eq $null) { break }
  $ps = [System.Windows.Forms.SystemInformation]::PowerStatus
  $onBattery = $ps.PowerLineStatus -eq 'Offline' -and $ps.BatteryChargeStatus -ne 'NoSystemBattery'
  $low = $onBattery -and ($ps.BatteryLifePercent * 100) -lt [int]$cfg.minBattery
  if ($low) { [void][CwPower]::SetThreadExecutionState($ES_CONTINUOUS) }
  else {
    $f = $ES_CONTINUOUS -bor $ES_SYSTEM
    if (-not $cfg.allowScreenOff) { $f = $f -bor $ES_DISPLAY }
    [void][CwPower]::SetThreadExecutionState($f)
  }
  Start-Sleep -Seconds 30
}
[void][CwPower]::SetThreadExecutionState($ES_CONTINUOUS)

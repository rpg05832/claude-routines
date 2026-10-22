# הדלקת קלוד, מסלול "מהמחשב": שולח הודעת צ'אט רגילה ב-claude.ai דרך הדפדפן, כמו משתמש.
# מופעל ע"י מתזמן המשימות של Windows בשעה שנקבעה, או מהתוכנה ("שלח עכשיו").
# מבוסס על הסקריפט "הודעה לקלוד" של צבי דורש ציון ועל Claude-notify של יאיר דניאל (רישיון MIT):
# פתיחת הדפדפן הרגיל עם הפרופיל שנבחר, הדבקה (Ctrl+V) ובדיקה שהטקסט נכנס לשדה, ו-Enter.
# לא מקליד ולא שולח אם: המחשב נעול, חלון אחר בחזית, הסמן בשורת הכתובת, או שהטקסט לא נכנס לשדה.
param(
  [string]$Digit = '1',
  [string]$Source = 'תזמון',
  [string]$ScheduledFor = ''   # "HH:mm" של התזמון: אם עברו יותר מ-10 דקות (המחשב התעורר מאוחר), לא שולחים
)
$ErrorActionPreference = 'Stop'
# שם המקור בעברית (במשימה המתוזמנת עוברים רק תווים באנגלית)
$Source = @{ schedule = 'תזמון'; now = 'כפתור' }[$Source]; if (-not $Source) { $Source = 'שליחה' }
$dataDir = Join-Path $env:APPDATA 'ClaudeWake'
$cfgFile = Join-Path $dataDir 'pc.json'
$logFile = Join-Path $dataDir 'pc-log.json'

function Write-Result([string]$detail, [bool]$ok) {
  try {
    $list = @()
    if (Test-Path $logFile) { $list = @(Get-Content $logFile -Raw -Encoding UTF8 | ConvertFrom-Json) }
    $entry = [pscustomobject]@{ at = (Get-Date).ToString('dd.MM HH:mm'); kind = $Source; detail = $detail; ok = $ok }
    $list = @($entry) + $list | Select-Object -First 40
    [IO.File]::WriteAllText($logFile, (ConvertTo-Json @($list) -Depth 3), (New-Object Text.UTF8Encoding $false))
  } catch { }
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CwNative {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetUserObjectInformationW")]
  public static extern bool GetUserObjectInformation(IntPtr h, int index, StringBuilder buf, uint len, out uint needed);
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
  public static bool IsLocked() {
    IntPtr d = OpenInputDesktop(0, false, 0x0001);
    if (d == IntPtr.Zero) return true;
    try { var sb = new StringBuilder(256); uint n; bool ok = GetUserObjectInformation(d, 2, sb, 512, out n);
          return ok && !sb.ToString().Equals("default", StringComparison.OrdinalIgnoreCase); }
    finally { CloseDesktop(d); }
  }
  public static uint ForegroundPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
}
'@

$VK_CONTROL = 0x11; $VK_V = 0x56; $VK_A = 0x41; $VK_C = 0x43; $VK_L = 0x4C; $VK_F6 = 0x75; $VK_TAB = 0x09; $VK_END = 0x23; $VK_RETURN = 0x0D
$script:browserHwnd = [IntPtr]::Zero

function Wake-Display {
  [void][CwNative]::SetThreadExecutionState(0x00000002)
  [CwNative]::mouse_event(0x0001, 1, 0, 0, [UIntPtr]::Zero)
  [CwNative]::mouse_event(0x0001, -1, 0, 0, [UIntPtr]::Zero)
}

# לוחץ מקש רק אם חלון הדפדפן עדיין בחזית. אחרת: שגיאה, והניסיון נעצר
function Press([byte]$vk, [bool]$ctrl = $false, [bool]$ext = $false) {
  if ([CwNative]::GetForegroundWindow() -ne $script:browserHwnd) { throw 'FOCUS_LOST' }
  $e = if ($ext) { 1 } else { 0 }
  if ($ctrl) { [CwNative]::keybd_event($VK_CONTROL, 0, 0, [UIntPtr]::Zero) }
  [CwNative]::keybd_event($vk, 0, $e, [UIntPtr]::Zero); Start-Sleep -Milliseconds 50
  [CwNative]::keybd_event($vk, 0, ($e -bor 2), [UIntPtr]::Zero)
  if ($ctrl) { [CwNative]::keybd_event($VK_CONTROL, 0, 2, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 50
}

# האם הפוקוס בתוך דף האינטרנט (ולא בשורת הכתובת), דרך UI Automation של Windows
function Focus-InPage {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  try {
    $doc = [System.Windows.Automation.ControlType]::Document
    $w = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $e = [System.Windows.Automation.AutomationElement]::FocusedElement
    for ($i = 0; $i -lt 50 -and $e -ne $null; $i++) {
      if ($e.Current.ControlType -eq $doc) { return $true }
      $e = $w.GetParent($e)
    }
    return $false
  } catch { return $false }
}

function Get-Clip { for ($i = 0; $i -lt 10; $i++) { try { if ([Windows.Forms.Clipboard]::ContainsText()) { return [Windows.Forms.Clipboard]::GetText() } else { return $null } } catch { Start-Sleep -Milliseconds 50 } }; return $null }
function Set-Clip([string]$t) { for ($i = 0; $i -lt 10; $i++) { try { if ([string]::IsNullOrEmpty($t)) { [Windows.Forms.Clipboard]::Clear() } else { [Windows.Forms.Clipboard]::SetDataObject($t, $true) }; return } catch { Start-Sleep -Milliseconds 50 } } }
function Norm([string]$s) { if ($s -eq $null) { return '' }; return (($s -split '\s+') | Where-Object { $_ }) -join ' ' }

# מדביק את הטקסט ובודק שהוא נכנס בדיוק. מחזיר $true אם הצליח
function Try-Paste($cfg, [string]$text, [string]$browserProc) {
  $script:browserHwnd = [CwNative]::GetForegroundWindow()
  $fg = try { (Get-Process -Id ([CwNative]::ForegroundPid())).ProcessName } catch { '' }
  if ($fg -ne $browserProc) { return $false }
  if ([int]$cfg.tabCount -gt 0) {
    Press $VK_L $true; Press $VK_F6
    for ($i = 0; $i -lt [int]$cfg.tabCount; $i++) { Press $VK_TAB }
  }
  if (-not (Focus-InPage)) { return $false }
  Set-Clip $text
  Press $VK_A $true; Press $VK_V $true; Start-Sleep -Milliseconds 300
  Set-Clip ''
  Press $VK_A $true; Press $VK_C $true; Start-Sleep -Milliseconds 300
  $got = Get-Clip
  if ([CwNative]::GetForegroundWindow() -ne $script:browserHwnd) { return $false }
  return (Norm $got) -eq (Norm $text)
}

$oldClip = $null
try {
  if (-not (Test-Path $cfgFile)) { Write-Result 'אין הגדרות למסלול "מהמחשב"' $false; exit 1 }
  $cfg = Get-Content $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $key = @($cfg.keys) | Where-Object { $_.digit -eq $Digit } | Select-Object -First 1
  if (-not $key) { Write-Result "אין מקש $Digit" $false; exit 1 }
  $label = if ($key.name) { "$($key.name) ($Digit)" } else { "מקש $Digit" }

  if ($ScheduledFor -match '^\d{1,2}:\d{2}$') {
    $t = [datetime]::ParseExact($ScheduledFor.PadLeft(5, '0'), 'HH:mm', $null)
    $late = ((Get-Date) - $t).TotalMinutes
    if ($late -lt -720) { $late += 1440 }
    if ($late -gt 10) { Write-Result "$($label): המחשב היה כבוי או ישן בשעה $ScheduledFor, ולכן לא נשלח באיחור" $false; exit 0 }
  }
  if (-not (Test-Path $cfg.browserExe)) { Write-Result "$($label): הדפדפן לא נמצא ($($cfg.browserExe))" $false; exit 1 }

  Wake-Display
  if ([CwNative]::IsLocked()) { Write-Result "$($label): המחשב היה נעול, ולכן לא נשלח" $false; exit 1 }

  $browserProc = [IO.Path]::GetFileNameWithoutExtension($cfg.browserExe)
  Start-Process -FilePath $cfg.browserExe -ArgumentList @("--profile-directory=`"$($cfg.profileFolder)`"", "`"$($cfg.url)`"")
  $oldClip = Get-Clip
  Start-Sleep -Seconds ([int]$cfg.minWait)
  $deadline = (Get-Date).AddSeconds([int]$cfg.maxWait)
  $done = $false
  while ((Get-Date) -lt $deadline) {
    Wake-Display
    if ([CwNative]::IsLocked()) { Write-Result "$($label): הדפדפן נפתח, אבל המחשב נעול ולכן לא הוקלד כלום" $false; break }
    $ok = $false
    try { $ok = Try-Paste $cfg $key.text $browserProc } catch { $ok = $false }
    if ($ok) {
      if ($cfg.sendEnter) {
        try { Press $VK_END $true $true; Start-Sleep -Milliseconds 200; Press $VK_RETURN }
        catch { Write-Result "$($label): הטקסט נכתב, אבל חלון אחר קפץ לחזית לפני השליחה, ולכן לא נשלח" $false; $done = $true; break }
        Write-Result "$($label): נשלח" $true
      } else { Write-Result "$($label): הטקסט נכתב (בלי Enter)" $true }
      $done = $true; break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $done -and (Get-Date) -ge $deadline) { Write-Result "$($label): הדף לא היה מוכן להקלדה בזמן, ולכן לא נשלח" $false }
} catch {
  Write-Result ("שגיאה: " + $_.Exception.Message) $false
} finally {
  Start-Sleep -Milliseconds 800
  if ($oldClip -ne $null) { Set-Clip $oldClip }
}

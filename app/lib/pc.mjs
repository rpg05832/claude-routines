// מסלול "מהמחשב": הודעת צ'אט רגילה ב-claude.ai דרך הדפדפן, גם במנוי החינמי. המחשב צריך להיות דלוק.
// השליחה עצמה: app/pc/send.ps1. התזמון: מתזמן המשימות של Windows (בלי תוכנה שרצה כל הזמן).
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { APP_DIR, DATA_DIR } from './paths.mjs';
import { log } from './store.mjs';

export const PC_DIR = process.env.CLAUDE_WAKE_PC_DIR || join(APP_DIR, 'pc');
export const PC_CONFIG = join(DATA_DIR, 'pc.json');
export const PC_LOG = join(DATA_DIR, 'pc-log.json');
const TASK_PATH = '\\ClaudeWake\\';

const BROWSERS = [
  ['Chrome', ['Google', 'Chrome', 'User Data'], ['Google', 'Chrome', 'Application', 'chrome.exe']],
  ['Edge', ['Microsoft', 'Edge', 'User Data'], ['Microsoft', 'Edge', 'Application', 'msedge.exe']],
  ['Brave', ['BraveSoftware', 'Brave-Browser', 'User Data'], ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe']],
];

/** הפרופילים של Chrome, Edge ו-Brave, מתוך הקובץ Local State של כל דפדפן (כמו ב-Claude-notify). */
export function listProfiles(env = process.env) {
  const local = env.LOCALAPPDATA || '';
  const bases = [env.ProgramFiles, env['ProgramFiles(x86)'], local].filter(Boolean);
  const out = [];
  for (const [name, dataRel, exeRel] of BROWSERS) {
    const exe = bases.map(b => join(b, ...exeRel)).find(existsSync);
    const state = join(local, ...dataRel, 'Local State');
    if (!exe || !existsSync(state)) continue;
    try {
      const cache = JSON.parse(readFileSync(state, 'utf8'))?.profile?.info_cache || {};
      for (const folder of Object.keys(cache).sort()) {
        const info = cache[folder] || {};
        out.push({ key: `${name}|${folder}`, browser: name, exe, folder, label: info.name || folder, email: info.user_name || '' });
      }
    } catch (e) { log('pc', 'profiles', name, e.message); }
  }
  return out;
}

export function defaultPc() {
  return { profileKey: '', url: 'https://claude.ai/new', minWait: 3, maxWait: 60, tabCount: 0, sendEnter: true, keepAwake: true, allowScreenOff: false, minBattery: 20, wake: true };
}

/** בודק ומחיל את הגדרות הדפדפן והחשמל. */
export function applyPc(cur, data = {}) {
  const p = { ...defaultPc(), ...cur };
  if (data.profileKey !== undefined) p.profileKey = String(data.profileKey);
  if (data.url !== undefined) {
    const u = String(data.url || '').trim() || 'https://claude.ai/new';
    if (!/^https:\/\/\S+$/.test(u)) throw new Error('כתובת האתר חייבת להתחיל ב-https://');
    p.url = u;
  }
  const num = (k, lo, hi) => { if (data[k] !== undefined) { const n = Math.round(Number(data[k])); if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`ערך לא תקין: ${k}`); p[k] = n; } };
  num('minWait', 0, 60); num('maxWait', 10, 600); num('tabCount', 0, 30); num('minBattery', 0, 100);
  for (const k of ['sendEnter', 'keepAwake', 'allowScreenOff', 'wake']) if (data[k] !== undefined) p[k] = !!data[k];
  return p;
}

/** כותב את pc.json שהסקריפטים קוראים: דפדפן, פרופיל, מקשים ותזמונים. */
export function writePcConfig(pc, settings, profiles = listProfiles()) {
  const prof = profiles.find(x => x.key === pc.profileKey);
  if (!prof) throw new Error('צריך לבחור פרופיל של Chrome, Edge או Brave');
  mkdirSync(DATA_DIR, { recursive: true });
  const cfg = {
    browserExe: prof.exe, profileFolder: prof.folder, url: pc.url,
    minWait: pc.minWait, maxWait: pc.maxWait, tabCount: pc.tabCount, sendEnter: pc.sendEnter,
    keepAwake: pc.keepAwake, allowScreenOff: pc.allowScreenOff, minBattery: pc.minBattery,
    keys: settings.keys.map(k => ({ digit: k.digit, name: k.name, text: k.text })),
    schedules: settings.schedules.map(s => ({ enabled: s.enabled, time: s.time, days: s.days, digit: s.digit })),
  };
  writeFileSync(PC_CONFIG, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

/** נתיב קצר (8.3) בלי עברית, למשימות של מתזמן המשימות. אם אין, הנתיב הרגיל. */
export function shortPath(p) {
  try {
    const out = execFileSync('cmd.exe', ['/d', '/c', `for %A in ("${p}") do @echo %~sA`], { encoding: 'latin1', windowsHide: true }).trim();
    if (/^[\x20-\x7e]+$/.test(out) && existsSync(out)) return out;
  } catch { /* */ }
  return p;
}

/** מריץ סקריפט PowerShell (נכתב לקובץ עם BOM, כדי שעברית תעבור נכון ב-PowerShell 5.1). */
function runPs(script, timeoutMs = 60_000) {
  const f = join(tmpdir(), `cw-${randomBytes(6).toString('hex')}.ps1`);
  writeFileSync(f, '﻿' + script, 'utf8');
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f], { encoding: 'utf8', windowsHide: true, timeout: timeoutMs });
  } catch (e) {
    throw new Error('מתזמן המשימות של Windows: ' + String(e.stderr || e.message).trim().split(/\r?\n/).slice(-3).join(' '));
  } finally { try { unlinkSync(f); } catch { /* */ } }
}

const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * רושם במתזמן המשימות משימה לכל תזמון פעיל (שבועית, בשעה ובימים שנבחרו), ומשימת "שמירה על ער" בכניסה ל-Windows.
 * המשימות הקודמות של התוכנה נמחקות קודם. בלי הרשאות מנהל: המשימות של המשתמש הנוכחי.
 */
export function syncTasks(settings, pc) {
  if (process.env.CLAUDE_WAKE_FAKE_TASKS) {   // בדיקות: לא נוגעים במתזמן האמיתי
    const tasks = settings.schedules.filter(x => x.enabled).map(s => ({ name: 'send-' + s.id, time: s.time, days: s.days, digit: s.digit, wake: pc.wake }));
    writeFileSync(process.env.CLAUDE_WAKE_FAKE_TASKS, JSON.stringify({ tasks, keepAwake: !!(tasks.length && pc.keepAwake) }, null, 2));
    return { tasks: tasks.length };
  }
  const vbs = shortPath(join(PC_DIR, 'run-hidden.vbs'));
  const send = shortPath(join(PC_DIR, 'send.ps1'));
  const awake = shortPath(join(PC_DIR, 'keepawake.ps1'));
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$path = ${psq(TASK_PATH)}`,
    "Get-ScheduledTask -TaskPath $path -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false",
    "$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name",
    "$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited",
  ];
  let n = 0;
  for (const s of settings.schedules.filter(x => x.enabled)) {
    const [h, m] = s.time.split(':').map(Number);
    const at = `(Get-Date).Date.AddHours(${h}).AddMinutes(${m})`;
    const args = `"${send}" -Digit ${s.digit} -Source schedule -ScheduledFor ${s.time}`;
    lines.push(
      `$t = New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${s.days.map(d => DAY_NAMES[d]).join(',')} -At ${at}`,
      `$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ${psq(`"${vbs}" ${args}`)}`,
      `$st = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew${pc.wake ? ' -WakeToRun' : ''}`,
      `Register-ScheduledTask -TaskPath $path -TaskName ${psq('send-' + s.id)} -Trigger $t -Action $a -Settings $st -Principal $principal -Description ${psq('הדלקת קלוד: ' + s.time)} | Out-Null`,
    );
    n++;
  }
  if (n && pc.keepAwake) {
    lines.push(
      "$t = New-ScheduledTaskTrigger -AtLogOn -User $user",
      `$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ${psq(`"${vbs}" "${awake}"`)}`,
      "$st = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew",
      "Register-ScheduledTask -TaskPath $path -TaskName 'keep-awake' -Trigger $t -Action $a -Settings $st -Principal $principal -Description 'הדלקת קלוד: שמירה על המחשב ער עד השליחה' | Out-Null",
      "Start-ScheduledTask -TaskPath $path -TaskName 'keep-awake'",
    );
  }
  lines.push(`"OK " + (Get-ScheduledTask -TaskPath $path -ErrorAction SilentlyContinue | Measure-Object).Count`);
  const out = runPs(lines.join('\n'));
  log('pc', 'tasks', out.trim());
  return { tasks: n };
}

/** מוחק את כל המשימות של התוכנה במתזמן (במעבר למסלול אחר, או בהסרה). */
export function removeTasks() {
  if (process.env.CLAUDE_WAKE_FAKE_TASKS) { writeFileSync(process.env.CLAUDE_WAKE_FAKE_TASKS, JSON.stringify({ tasks: [], removed: true })); return; }
  runPs(`Get-ScheduledTask -TaskPath ${psq(TASK_PATH)} -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false`);
}

/** "שלח עכשיו": מריץ את סקריפט השליחה מיד (התוצאה נרשמת ב-pc-log.json תוך כמה שניות). */
export function runNow(digit) {
  if (process.env.CLAUDE_WAKE_NO_EXTERNAL) { log('pc', 'runNow (בדיקות: לא מריצים)', digit); return; }
  spawn('wscript.exe', [join(PC_DIR, 'run-hidden.vbs'), join(PC_DIR, 'send.ps1'), '-Digit', String(digit), '-Source', 'now'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

export function readPcLog() {
  try { return JSON.parse(readFileSync(PC_LOG, 'utf8').replace(/^﻿/, '')); } catch { return []; }
}

/** מחשבים שבהם כיבוי המסך מרדים את המחשב (Modern Standby): שם "לאפשר למסך לכבות" לא עובד. */
export function isModernStandby() {
  try { return /S0 Low Power Idle/i.test(execFileSync('powercfg', ['/a'], { encoding: 'latin1', windowsHide: true })); } catch { return false; }
}

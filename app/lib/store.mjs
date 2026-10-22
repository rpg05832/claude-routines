// המצב המקומי של התוכנה (%APPDATA%\ClaudeWake\config.json): המסלול, ההגדרות ופרטי כל מסלול.
// ההגדרות כוללות טוקנים (של הרוטינה, ימות ו-GitHub), כי התוכנה מעלה אותם בעצמה. הקובץ נמצא בפרופיל המשתמש בלבד.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DATA_DIR, CONFIG_FILE, LOG_FILE } from './paths.mjs';
import { defaultSettings } from './settings.mjs';

const LOCAL_LOG_MAX = 40;

export function defaults() {
  return {
    mode: '',            // google | claude | github
    wizardDone: false,
    settings: defaultSettings(),
    google: { scriptId: '', deploymentId: '', execUrl: '', adminKey: '', deployedVersion: '', email: '', authorized: false, configSavedAt: '' },
    claude: { envId: '', routines: {}, manual: {}, offset: null, lastSync: '' },
    github: { token: '', owner: '', repo: '', isPrivate: false, tokensSent: {}, branch: 'main' },
    localLog: [],
  };
}

export function loadLocal(file = CONFIG_FILE) {
  let raw = {};
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { /* קובץ חדש */ }
  const d = defaults();
  const out = { ...d, ...raw };
  for (const k of ['settings', 'google', 'claude', 'github']) out[k] = { ...d[k], ...(raw[k] || {}) };
  out.settings.yemot = { ...d.settings.yemot, ...(raw.settings?.yemot || {}) };
  // גרסה 1.0: פרטי גוגל ישירות בשורש
  for (const k of ['scriptId', 'deploymentId', 'execUrl', 'adminKey', 'deployedVersion']) if (raw[k] && !out.google[k]) out.google[k] = raw[k];
  if (!out.mode && out.google.scriptId) out.mode = 'google';
  return out;
}

export function saveLocal(patch, file = CONFIG_FILE) {
  mkdirSync(DATA_DIR, { recursive: true });
  const cur = loadLocal(file);
  const next = { ...cur, ...patch };
  for (const k of ['google', 'claude', 'github']) if (patch[k]) next[k] = { ...cur[k], ...patch[k] };
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  renameSync(tmp, file);
  return next;
}

/** מפתח ניהול לסקריפט בגוגל: 32 תווים הקסדצימליים (128 ביט). נוצר פעם אחת. */
export function ensureAdminKey(file = CONFIG_FILE) {
  const cur = loadLocal(file);
  if (/^[0-9a-f]{32}$/.test(cur.google.adminKey)) return cur.google.adminKey;
  return saveLocal({ google: { adminKey: randomBytes(16).toString('hex') } }, file).google.adminKey;
}

/** רישום ביומן המקומי שמוצג בלוח הבקרה. */
export function addLocalLog(kind, detail, ok, file = CONFIG_FILE) {
  const cur = loadLocal(file);
  const at = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(',', '');
  saveLocal({ localLog: [{ at, kind, detail: String(detail).slice(0, 200), ok: !!ok }, ...cur.localLog].slice(0, LOCAL_LOG_MAX) }, file);
}

export function log(...parts) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${parts.join(' ')}\n`, 'utf8');
  } catch { /* יומן לא קריטי */ }
}

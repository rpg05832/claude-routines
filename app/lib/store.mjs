// ההגדרות המקומיות של התוכנה. הטוקנים של קלוד וימות לא נשמרים כאן: הם נשמרים רק בסקריפט שבגוגל.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DATA_DIR, CONFIG_FILE, LOG_FILE } from './paths.mjs';

const DEFAULTS = { scriptId: '', deploymentId: '', execUrl: '', adminKey: '', deployedVersion: '', wizardDone: false, googleEmail: '' };

export function loadLocal(file = CONFIG_FILE) {
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(file, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}

export function saveLocal(patch, file = CONFIG_FILE) {
  mkdirSync(DATA_DIR, { recursive: true });
  const next = { ...loadLocal(file), ...patch };
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  renameSync(tmp, file);
  return next;
}

/** מפתח ניהול: 32 תווים הקסדצימליים (128 ביט). נוצר פעם אחת. */
export function ensureAdminKey(file = CONFIG_FILE) {
  const cur = loadLocal(file);
  if (/^[0-9a-f]{32}$/.test(cur.adminKey)) return cur.adminKey;
  return saveLocal({ adminKey: randomBytes(16).toString('hex') }, file).adminKey;
}

export function log(...parts) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${parts.join(' ')}\n`, 'utf8');
  } catch { /* יומן לא קריטי */ }
}

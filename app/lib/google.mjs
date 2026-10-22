// חיבור לגוגל והעלאת הסקריפט, דרך clasp (הכלי הרשמי של גוגל ל-Apps Script).
// clasp רץ כתהליך נפרד עם אותו node.exe. ההתחברות נשמרת אצל clasp (~/.clasprc.json).
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CLASP, PROJECT_DIR, SCRIPT_SRC } from './paths.mjs';
import { log } from './store.mjs';
import { configGs } from './settings.mjs';

export const API_SETTINGS_URL = 'https://script.google.com/home/usersettings';
const API_DISABLED_RE = /has not enabled the Apps Script API|Apps Script API has not been used|usersettings/i;

/** מריץ פקודת clasp. מחזיר {code, out}. */
export function runClasp(args, { cwd = PROJECT_DIR, timeoutMs = 120_000, onLine } = {}) {
  mkdirSync(cwd, { recursive: true });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--no-warnings', '--use-system-ca', CLASP, ...args], {   // use-system-ca: תעודות האבטחה של Windows
      cwd, windowsHide: true, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    let out = '';
    const take = (d) => {
      const s = d.toString();
      out += s;
      if (onLine) s.split(/\r?\n/).filter(Boolean).forEach(onLine);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => { child.kill(); out += '\n(חרג מהזמן)'; }, timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); log('clasp', args[0], 'exit', code); resolve({ code, out }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e.message) }); });
  });
}

/** הודעת שגיאה ברורה מפלט של clasp. */
export function explainClaspError(out) {
  if (/netfree\.link\/block/i.test(out)) {
    const reason = (/%22block%22:%22(\w+)%22/.exec(out) || /"block"\s*:\s*"(\w+)"/.exec(out) || [])[1] || '';
    return { code: 'FILTERED', message: reason === 'badwords'
      ? 'סינון האינטרנט חסם את ההעלאה לגוגל בגלל מילה בתוכן. אם כתבת הודעה או משפט פתיחה, נסה לנסח אחרת. אם זה חוזר, שלח את היומן למפתח.'
      : 'סינון האינטרנט חסם את הפנייה לגוגל' + (reason ? ' (' + reason + ')' : '') + '. צריך שהאתר script.googleapis.com יהיה נגיש.' };
  }
  if (API_DISABLED_RE.test(out)) return { code: 'API_DISABLED', message: 'צריך להפעיל את "Google Apps Script API" בהגדרות של גוגל (מתג אחד), ואז לנסות שוב.' };
  if (/not logged in|login required|No credentials|invalid_grant|Could not read API credentials/i.test(out)) return { code: 'NOT_LOGGED_IN', message: 'צריך להתחבר לגוגל.' };
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|certificate|self.signed/i.test(out)) return { code: 'NETWORK', message: 'אין חיבור לגוגל. ודא שהאתר script.google.com נגיש פתוח ושהתעודה של נטפרי מותקנת.' };
  const last = out.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ');
  return { code: 'CLASP', message: last.slice(0, 300) || 'שגיאה לא ידועה' };
}

/** מי מחובר לגוגל, או null. */
export async function whoAmI() {
  const r = await runClasp(['show-authorized-user', '--json'], { timeoutMs: 30_000 });
  try {
    const j = JSON.parse(r.out.slice(r.out.indexOf('{')));
    if (j.loggedIn === false) return null;
    return j.email || j.user || (j.loggedIn ? 'מחובר' : null);
  } catch {
    const m = /logged in as ([^\s]+@[^\s]+)/i.exec(r.out);
    return m ? m[1] : (/not logged in/i.test(r.out) ? null : null);
  }
}

/** פותח את דף ההתחברות של גוגל בדפדפן ומחכה שהמשתמש יאשר (עד 5 דקות). */
export async function login() {
  const r = await runClasp(['login'], { timeoutMs: 300_000 });
  if (r.code !== 0) throw Object.assign(new Error(explainClaspError(r.out).message), { detail: r.out });
  return whoAmI();
}

export async function logout() { await runClasp(['logout'], { timeoutMs: 30_000 }); }

/** בודק שה-API של Apps Script מופעל (רשימת הסקריפטים מצליחה). */
export async function checkApi() {
  const r = await runClasp(['list-scripts', '--json'], { timeoutMs: 60_000 });
  if (r.code === 0 && !API_DISABLED_RE.test(r.out)) return { ok: true };
  return { ok: false, ...explainClaspError(r.out) };
}

/** מכין את תיקיית הפרויקט: קבצי הסקריפט, Secrets.gs עם מפתח הניהול ו-Config.gs עם ההגדרות. קבצים אחרים נמחקים. */
export function writeProjectFiles(adminKey, settings, { dir = PROJECT_DIR, src = SCRIPT_SRC } = {}) {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f !== '.clasp.json') rmSync(join(dir, f), { recursive: true, force: true });
  copyFileSync(join(src, 'Code.gs'), join(dir, 'Code.gs'));
  copyFileSync(join(src, 'appsscript.json'), join(dir, 'appsscript.json'));
  writeFileSync(join(dir, 'Secrets.gs'), `// נוצר על ידי תוכנת "הדלקת קלוד". מפתח הניהול: לא לשתף.\nvar ADMIN_KEY = '${adminKey}';\n`, 'utf8');
  writeFileSync(join(dir, 'Config.gs'), configGs(settings), 'utf8');
}

export function scriptVersionOf(src = SCRIPT_SRC) {
  const m = /var SCRIPT_VERSION = '([^']+)'/.exec(readFileSync(join(src, 'Code.gs'), 'utf8'));
  return m ? m[1] : '';
}

export function deploymentIdFrom(out) {
  const ids = String(out).match(/AKfyc[\w-]{20,}/g);
  return ids ? ids[ids.length - 1] : '';
}

const EXEC_BASE = process.env.CLAUDE_WAKE_EXEC_BASE || 'https://script.google.com';   // משתנה רק בבדיקות
export const execUrlFor = (deploymentId) => `${EXEC_BASE}/macros/s/${deploymentId}/exec`;

/**
 * יוצר את הסקריפט בגוגל (אם עוד אין), מעלה את הקוד ומפרסם כ-Web app.
 * בפעם הראשונה: deployment חדש. בעדכון: אותו deployment, כך שהכתובת לא משתנה.
 */
export async function deploy({ local, adminKey, settings, onStep = () => {} }) {
  const fail = (r) => { const e = explainClaspError(r.out); throw Object.assign(new Error(e.message), { code: e.code, detail: r.out }); };
  let scriptId = local.scriptId;
  const claspJson = join(PROJECT_DIR, '.clasp.json');
  // פרויקט שנוצר בניסיון קודם שנכשל באמצע: משתמשים בו, ולא יוצרים פרויקט נוסף בחשבון
  if (!scriptId && existsSync(claspJson)) {
    try { scriptId = JSON.parse(readFileSync(claspJson, 'utf8')).scriptId || ''; } catch { /* קובץ פגום: נוצר חדש */ }
    if (scriptId) onStep('ממשיך עם הפרויקט שכבר נוצר בגוגל');
  }
  if (!scriptId || !existsSync(claspJson)) {
    if (scriptId) {
      writeFileSync(claspJson, JSON.stringify({ scriptId, rootDir: '.' }), 'utf8');
    } else {
      onStep('יוצר פרויקט חדש בגוגל');
      rmSync(PROJECT_DIR, { recursive: true, force: true });
      const r = await runClasp(['create-script', '--type', 'standalone', '--title', 'הדלקת קלוד', '--rootDir', '.']);
      if (r.code !== 0) fail(r);
      scriptId = JSON.parse(readFileSync(claspJson, 'utf8')).scriptId;
      if (!scriptId) fail({ out: r.out + '\nלא התקבל מזהה סקריפט' });
    }
  }
  onStep('מעלה את הקוד וההגדרות');
  writeProjectFiles(adminKey, settings);
  const p = await runClasp(['push', '--force']);
  if (p.code !== 0) fail(p);

  const version = scriptVersionOf();
  let deploymentId = local.deploymentId;
  if (deploymentId) {
    onStep('מעדכן את הפרסום');
    const u = await runClasp(['update-deployment', deploymentId, '-d', 'הדלקת קלוד ' + version]);
    if (u.code !== 0) fail(u);
  } else {
    onStep('מפרסם כ-Web app');
    const d = await runClasp(['create-deployment', '-d', 'הדלקת קלוד ' + version]);
    if (d.code !== 0) fail(d);
    deploymentId = deploymentIdFrom(d.out);
    if (!deploymentId) fail({ out: d.out + '\nלא התקבל מזהה פרסום' });
  }
  return { scriptId, deploymentId, execUrl: execUrlFor(deploymentId), deployedVersion: version };
}

export const editorUrl = (scriptId) => `https://script.google.com/d/${scriptId}/edit`;
export const triggersUrl = (scriptId) => `https://script.google.com/home/projects/${scriptId}/triggers`;

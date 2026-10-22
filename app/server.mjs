// הדלקת קלוד: תוכנת ההגדרה והניהול במחשב.
// שרת קטן שמאזין רק ב-127.0.0.1 ופותח חלון אפליקציה (Edge). כל העבודה עצמה רצה בסקריפט שבגוגל,
// ולכן התוכנה לא צריכה לרוץ כל הזמן: היא נסגרת לבד כמה דקות אחרי שהחלון נסגר.
import http from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { APP_DIR, DATA_DIR, UI_FILE } from './lib/paths.mjs';
import { loadLocal, saveLocal, ensureAdminKey, log } from './lib/store.mjs';
import * as google from './lib/google.mjs';
import { callRemote } from './lib/remote.mjs';

const WEB = join(APP_DIR, 'web');
const APP_VERSION = (() => { try { return readFileSync(join(APP_DIR, '..', 'version.txt'), 'utf8').trim(); } catch { return 'dev'; } })();
const IDLE_EXIT_MS = 3 * 60_000;
const noOpen = process.argv.includes('--no-open');

/** כתובות קבועות שהממשק יכול לבקש לפתוח בדפדפן (לא כתובת חופשית מהממשק). */
const LINKS = {
  apiSettings: () => google.API_SETTINGS_URL,
  routines: () => 'https://claude.ai/code/routines',
  usage: () => 'https://claude.ai/settings/usage',
  authorize: () => loadLocal().execUrl,
  editor: () => loadLocal().scriptId && google.editorUrl(loadLocal().scriptId),
};

/* ---------- מופע יחיד ---------- */
async function existingInstance() {
  try {
    const ui = JSON.parse(readFileSync(UI_FILE, 'utf8'));
    const r = await fetch(`http://127.0.0.1:${ui.port}/api/ping`, { method: 'POST', headers: { 'x-token': ui.token }, signal: AbortSignal.timeout(1500) });
    if (r.ok) return ui;
  } catch { /* אין מופע פעיל */ }
  return null;
}

function findEdge() {
  const c = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean).map(b => join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  return c.find(existsSync) || null;
}

function openUrl(url) {
  log('open', url.replace(/\?.*$/, ''));
  if (process.env.CLAUDE_WAKE_NO_EXTERNAL) return;   // בדיקות: לא פותחים דפדפן אמיתי
  spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

function openAppWindow(url) {
  const edge = findEdge();
  if (edge) spawn(edge, [`--app=${url}`, '--window-size=980,860'], { detached: true, stdio: 'ignore' }).unref();
  else openUrl(url);
}

const prev = await existingInstance();
if (prev) {
  if (!noOpen) openAppWindow(`http://127.0.0.1:${prev.port}/?t=${prev.token}`);
  process.exit(0);
}

/* ---------- שרת ---------- */
const token = process.env.CLAUDE_WAKE_DEV_TOKEN || randomBytes(18).toString('hex');   // DEV_TOKEN: בדיקות בלבד
let lastBeat = Date.now();
let busy = false;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', d => { s += d; if (s.length > 200_000) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function status() {
  const l = loadLocal();
  return {
    appVersion: APP_VERSION,
    bundledScriptVersion: google.scriptVersionOf(),
    deployedVersion: l.deployedVersion,
    deployed: !!l.execUrl,
    wizardDone: l.wizardDone,
    googleEmail: l.googleEmail,
    scriptId: l.scriptId,
  };
}

const remote = (op, args) => { const l = loadLocal(); return callRemote(l.execUrl, l.adminKey, op, args); };

const routes = {
  ping: async () => ({ ok: true }),
  heartbeat: async () => ({ ok: true }),
  status: async () => status(),
  'google/whoami': async () => {
    const email = await google.whoAmI();
    saveLocal({ googleEmail: email || '' });
    return { email };
  },
  'google/login': async () => {
    const email = await google.login();
    saveLocal({ googleEmail: email || '' });
    return { email };
  },
  'google/logout': async () => { await google.logout(); saveLocal({ googleEmail: '' }); return { ok: true }; },
  'google/check-api': async () => google.checkApi(),
  deploy: async () => {
    if (busy) throw new Error('העלאה כבר רצה');
    busy = true;
    const steps = [];
    try {
      const adminKey = ensureAdminKey();
      const r = await google.deploy({ local: loadLocal(), adminKey, onStep: s => { steps.push(s); log('deploy', s); } });
      saveLocal(r);
      return { ...r, steps };
    } finally { busy = false; }
  },
  /** בודק שהסקריפט עונה. needsAuth: צריך לאשר הרשאות בגוגל. */
  'remote/ping': async () => {
    try { return { ok: true, ...(await remote('ping')) }; }
    catch (e) { if (e.code === 'NEEDS_AUTH') return { ok: false, needsAuth: true, message: e.message }; throw e; }
  },
  remote: async (b) => {
    const allowed = ['state', 'save', 'fire', 'connectYemot', 'rotateYemotKey', 'clearLog'];
    if (!allowed.includes(b.op)) throw new Error('פעולה לא מוכרת');
    return remote(b.op, b.args || {});
  },
  open: async (b) => {
    const url = LINKS[b.what] && LINKS[b.what]();
    if (!url) throw new Error('אין מה לפתוח');
    openUrl(url);
    return { ok: true };
  },
  'wizard/done': async () => { saveLocal({ wizardDone: true }); return { ok: true }; },
  'wizard/reset': async () => { saveLocal({ wizardDone: false }); return { ok: true }; },
  quit: async () => { setTimeout(() => shutdown(), 100); return { ok: true }; },
};

const server = http.createServer(async (req, res) => {
  try {
    // מגן מפני DNS rebinding: רק 127.0.0.1 עם הפורט שלנו
    const host = req.headers.host || '';
    if (host !== `127.0.0.1:${server.address().port}`) return send(res, 403, { error: 'host' });
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET') {
      if (url.pathname === '/') {
        if (url.searchParams.get('t') !== token) return send(res, 403, '<p dir="rtl">פתח את התוכנה מקיצור הדרך "הדלקת קלוד".</p>', 'text/html; charset=utf-8');
        return send(res, 200, readFileSync(join(WEB, 'index.html')), MIME['.html']);
      }
      const rel = normalize(url.pathname).replace(/^[\\/]+/, '');
      const file = join(WEB, rel);
      if (!file.startsWith(WEB) || !existsSync(file)) return send(res, 404, { error: 'not found' });
      return send(res, 200, readFileSync(file), MIME[extname(file)] || 'application/octet-stream');
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      if (req.headers['x-token'] !== token) return send(res, 403, { error: 'token' });
      lastBeat = Date.now();
      const fn = routes[url.pathname.slice(5)];
      if (!fn) return send(res, 404, { error: 'not found' });
      const body = await readBody(req);
      try { return send(res, 200, { ok: true, result: await fn(body) }); }
      catch (e) {
        log('api', url.pathname, 'error', e.message, e.detail ? String(e.detail).slice(0, 2000) : '');
        return send(res, 200, { ok: false, error: e.message, code: e.code || '' });
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    log('server', e.stack || e.message);
    send(res, 500, { error: 'שגיאה פנימית' });
  }
});

function shutdown() {
  try { unlinkSync(UI_FILE); } catch { /* */ }
  log('server', 'נסגר');
  process.exit(0);
}

server.listen(Number(process.env.CLAUDE_WAKE_DEV_PORT || 0), '127.0.0.1', () => {
  const port = server.address().port;
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(UI_FILE, JSON.stringify({ port, token, pid: process.pid }), 'utf8');
  log('server', `מאזין ב-127.0.0.1:${port}, גרסה ${APP_VERSION}`);
  const url = `http://127.0.0.1:${port}/?t=${token}`;
  if (!noOpen) openAppWindow(url);
  if (process.env.CLAUDE_WAKE_PRINT_URL) console.log(url);
});

// נסגרים כשהחלון סגור (אין דופק) ואין עבודה ברקע
setInterval(() => { if (!busy && Date.now() - lastBeat > IDLE_EXIT_MS) shutdown(); }, 30_000).unref();
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

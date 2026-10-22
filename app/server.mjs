// הדלקת קלוד: תוכנת ההגדרה והניהול במחשב.
// שרת קטן שמאזין רק ב-127.0.0.1 ופותח חלון אפליקציה (Edge). ההדלקה עצמה רצה בענן (גוגל, claude.ai או GitHub),
// ולכן התוכנה לא צריכה לרוץ כל הזמן: היא נסגרת לבד כמה דקות אחרי שהחלון נסגר.
import http from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { APP_DIR, DATA_DIR, UI_FILE } from './lib/paths.mjs';
import { log } from './lib/store.mjs';
import { makeRoutes, dstCatchUp } from './lib/routes.mjs';

const WEB = join(APP_DIR, 'web');
const APP_VERSION = (() => { try { return readFileSync(join(APP_DIR, '..', 'version.txt'), 'utf8').trim(); } catch { return 'dev'; } })();
const IDLE_EXIT_MS = 3 * 60_000;
const noOpen = process.argv.includes('--no-open');

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
  if (edge) spawn(edge, [`--app=${url}`, '--window-size=1000,880'], { detached: true, stdio: 'ignore' }).unref();
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
let inFlight = 0;
const routes = makeRoutes({ appVersion: APP_VERSION, openUrl });

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

const server = http.createServer(async (req, res) => {
  try {
    // מגן מפני DNS rebinding: רק 127.0.0.1 עם הפורט שלנו
    if ((req.headers.host || '') !== `127.0.0.1:${server.address().port}`) return send(res, 403, { error: 'host' });
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET') {
      if (url.pathname === '/') {
        if (url.searchParams.get('t') !== token) return send(res, 403, '<p dir="rtl">פתח את התוכנה מקיצור הדרך "הדלקת קלוד".</p>', 'text/html; charset=utf-8');
        return send(res, 200, readFileSync(join(WEB, 'index.html')), MIME['.html']);
      }
      const file = join(WEB, normalize(url.pathname).replace(/^[\\/]+/, ''));
      if (!file.startsWith(WEB) || !existsSync(file)) return send(res, 404, { error: 'not found' });
      return send(res, 200, readFileSync(file), MIME[extname(file)] || 'application/octet-stream');
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      if (req.headers['x-token'] !== token) return send(res, 403, { error: 'token' });
      lastBeat = Date.now();
      const fn = routes[url.pathname.slice(5)];
      if (!fn) return send(res, 404, { error: 'not found' });
      const body = await readBody(req);
      inFlight++;
      try { return send(res, 200, { ok: true, result: await fn(body) }); }
      catch (e) {
        log('api', url.pathname, 'error', e.message, e.detail ? String(e.detail).slice(0, 3000) : '');
        return send(res, 200, { ok: false, error: e.message, code: e.code || '' });
      } finally { inFlight--; lastBeat = Date.now(); }
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
  dstCatchUp().catch(e => log('dst', e.message));
});

// נסגרים כשהחלון סגור (אין דופק) ואין עבודה ברקע
setInterval(() => { if (!inFlight && Date.now() - lastBeat > IDLE_EXIT_MS) shutdown(); }, 30_000).unref();
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

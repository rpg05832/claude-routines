// גוגל מדומה: מריץ את Code.gs עם Config.gs ו-Secrets.gs שהתוכנה "העלתה" (מתיקיית הפרויקט שלה), מאחורי HTTP.
// FAKE_BLOCK=1: מתנהג כמו נטפרי (418) לכל קריאה מהתוכנה. ימות (?k=) לא עוברים דרך נטפרי ולכן לא נחסמים.
// שימוש: node tests/fake/fake-google.mjs <port> <projectDir>
import http from 'node:http';
import vm from 'node:vm';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeEnv } from '../gas-harness.mjs';

const port = Number(process.argv[2] || 8790);
const dir = process.argv[3];
let env = null, stamp = '';

function getEnv() {
  const cfgFile = join(dir, 'Config.gs'), secFile = join(dir, 'Secrets.gs');
  if (!existsSync(cfgFile) || !existsSync(secFile)) return null;
  const s = statSync(cfgFile).mtimeMs + ':' + statSync(secFile).mtimeMs;
  if (env && s === stamp) return env;
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(readFileSync(cfgFile, 'utf8') + '\n' + readFileSync(secFile, 'utf8'), ctx);
  const prevProps = env?.store;
  env = makeEnv({
    now: null, adminKey: ctx.ADMIN_KEY, config: ctx.CONFIG, execUrl: `http://127.0.0.1:${port}/macros/s/AKfycbFAKEDEPLOYMENT1234567890/exec`,
    fetchHook: (url) => url.includes('anthropic.com') ? { getResponseCode: () => 200, getContentText: () => '{"claude_code_session_url":"https://claude.ai/code/session_fake"}' } : null,
  });
  if (prevProps) Object.assign(env.store, prevProps);   // היומן נשמר בין עדכוני קוד, כמו ב-Script Properties
  stamp = s;
  return env;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.endsWith('/exec')) { res.writeHead(404); res.end(); return; }
  const params = Object.fromEntries(url.searchParams);
  if (process.env.FAKE_BLOCK && params.k === undefined) { res.writeHead(418, { 'content-type': 'text/html' }); res.end('<html>blockByNetFree netfree.link</html>'); return; }
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const e = getEnv();
    if (!e) { res.writeHead(404); res.end('no script'); return; }
    const r = req.method === 'POST' ? e.g.doPost({ parameter: params, postData: { contents: body } }) : e.g.doGet({ parameter: params });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.text ?? 'html');
  });
}).listen(port, '127.0.0.1', () => console.log('fake google on', port, process.env.FAKE_BLOCK ? '(netfree block)' : ''));

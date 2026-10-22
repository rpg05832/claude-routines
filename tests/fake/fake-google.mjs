// גוגל מדומה לבדיקות: מריץ את Code.gs (דרך ההדמיה) מאחורי HTTP, כמו Web app.
// עד שקוראים ל-/authorize-me הוא מחזיר דף "Authorization is required", כמו סקריפט שעוד לא אושרו לו הרשאות.
// שימוש: node tests/fake/fake-google.mjs <port> <adminKeyFile>
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { makeEnv } from '../gas-harness.mjs';

const port = Number(process.argv[2] || 8790);
const keyFile = process.argv[3];
let authorized = false;
let env = null;

function getEnv() {
  // מפתח הניהול נקרא מההגדרות המקומיות של התוכנה (במציאות הוא מגיע בקובץ Secrets.gs)
  const key = existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, 'utf8')).adminKey : '';
  if (!env || env.key !== key) {
    env = makeEnv({
      now: null, adminKey: key, execUrl: `http://127.0.0.1:${port}/macros/s/AKfycbFAKEDEPLOYMENT1234567890/exec`,
      fetchHook: (url) => url.includes('anthropic.com')
        ? { getResponseCode: () => 200, getContentText: () => JSON.stringify({ claude_code_session_url: 'https://claude.ai/code/session_fake' }) }
        : null,
    });
    env.key = key;
  }
  return env;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/authorize-me') { authorized = true; res.end('ok'); return; }
  if (!url.pathname.endsWith('/exec')) { res.writeHead(404); res.end(); return; }
  if (!authorized) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><title>Authorization is required to perform that action.</title></html>'); return; }
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const e = getEnv();
    const params = Object.fromEntries(url.searchParams);
    const r = req.method === 'POST' ? e.g.doPost({ parameter: params, postData: { contents: body } }) : e.g.doGet({ parameter: params });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.text ?? 'html');
  });
}).listen(port, '127.0.0.1', () => console.log('fake google on', port));

// נטען לפני התוכנה במצב פיתוח (node --import): מפנה את הקריאות לקלוד, לימות ול-GitHub לשירותים מדומים בתוך התהליך.
// המצב של GitHub המדומה נשמר בקובץ, כדי שאפשר יהיה לבדוק מה הועלה.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA = process.env.CLAUDE_WAKE_DATA;
const GH_FILE = join(DATA, 'fake-github.json');
const realFetch = globalThis.fetch;
const res = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const gh = () => existsSync(GH_FILE) ? JSON.parse(readFileSync(GH_FILE, 'utf8')) : { repos: {}, files: {}, secrets: [], dispatches: [] };
const saveGh = (s) => writeFileSync(GH_FILE, JSON.stringify(s, null, 2));
export const fired = [];

globalThis.fetch = async (url, o = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.anthropic.com/v1/claude_code/routines/')) {
    const auth = (o.headers?.authorization || o.headers?.Authorization || '');
    if (!/^Bearer sk-/.test(auth)) return res(401, { error: { message: 'invalid token' } });
    return res(200, { type: 'routine_fire', claude_code_session_url: 'https://claude.ai/code/session_fake' });
  }
  if (u.startsWith('https://www.call2all.co.il/ym/api/')) {
    const body = JSON.parse(o.body || '{}');
    if (body.token !== 'ytoken') return res(200, { responseStatus: 'ERROR', message: 'token invalid' });
    if (u.endsWith('/UpdateExtension')) writeFileSync(join(DATA, 'fake-yemot.json'), JSON.stringify(body));
    return res(200, { responseStatus: 'OK', units: 50 });
  }
  if (u.startsWith('https://api.github.com/')) {
    const auth = o.headers?.authorization || '';
    if (auth !== 'Bearer github_pat_test') return res(401, { message: 'Bad credentials' });
    const path = u.slice('https://api.github.com'.length).replace(/\?.*$/, '');
    const s = gh(), m = o.method || 'GET';
    if (path === '/user') return res(200, { login: 'ab1234' });
    let x;
    if ((x = /^\/repos\/([^/]+\/[^/]+)$/.exec(path))) return s.repos[x[1]] ? res(200, s.repos[x[1]]) : res(404, { message: 'Not Found' });
    if (path === '/user/repos' && m === 'POST') { const b = JSON.parse(o.body); const full = 'ab1234/' + b.name; s.repos[full] = { full_name: full, private: b.private, default_branch: 'main' }; saveGh(s); return res(201, s.repos[full]); }
    if ((x = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(path))) {
      const key = x[1] + ':' + decodeURIComponent(x[2]);
      if (m === 'GET') return s.files[key] ? res(200, { sha: 'sha1', content: s.files[key] }) : res(404, {});
      s.files[key] = JSON.parse(o.body).content; saveGh(s); return res(201, {});
    }
    if (/\/actions\/secrets\/public-key$/.test(path)) return res(200, { key: Buffer.alloc(32, 7).toString('base64'), key_id: 'k1' });
    if ((x = /\/actions\/secrets\/(\w+)$/.exec(path))) { s.secrets.push(x[1]); saveGh(s); return res(201, {}); }
    if (/\/dispatches$/.test(path)) { s.dispatches.push(JSON.parse(o.body)); saveGh(s); return res(204, ''); }
    if (/\/runs$/.test(path)) return res(200, { workflow_runs: s.dispatches.map((d, i) => ({ created_at: new Date().toISOString(), event: 'workflow_dispatch', status: 'completed', conclusion: 'success', html_url: 'https://github.com/x/' + i })) });
    return res(404, { message: 'Not Found' });
  }
  return realFetch(url, o);
};

// בדיקות למסלול GitHub: הצפנת Secrets, יצירת הקבצים והתאמה ל-wake.py, וסנכרון מול GitHub מדומה.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nacl from '../app/node_modules/tweetnacl/nacl-fast.js';
import { sealedBox, openSealedBox, secretSuffix, wakeJson, workflowYml, GitHub, syncRepo } from '../app/lib/github.mjs';
import { applySettings, defaultSettings } from '../app/lib/settings.mjs';

const URL_OK = 'https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire';

test('הצפנת Secret נפתחת רק עם המפתח הפרטי', () => {
  const kp = nacl.box.keyPair();
  const enc = sealedBox('sk-secret-טוקן', Buffer.from(kp.publicKey).toString('base64'));
  assert.equal(openSealedBox(enc, kp.publicKey, kp.secretKey), 'sk-secret-טוקן');
  assert.equal(openSealedBox(enc, kp.publicKey, nacl.box.keyPair().secretKey), null);
  assert.notEqual(sealedBox('x', Buffer.from(kp.publicKey).toString('base64')), sealedBox('x', Buffer.from(kp.publicKey).toString('base64')), 'כל הצפנה עם מפתח זמני חדש');
});

test('קבצי הריפו תואמים ל-wake.py', () => {
  const s = applySettings(defaultSettings(), {
    connections: [{ id: 'main', name: 'א', fireUrl: URL_OK, token: 't1' }, { id: 'c-work', name: 'ב', fireUrl: URL_OK, token: 't2' }],
    keys: [{ digit: '1', name: 'הדלקה', connectionId: 'main', text: 'בוקר טוב' }, { digit: '2', name: 'עבודה', connectionId: 'c-work', text: 'x' }],
    schedules: [{ enabled: true, time: '07:10', days: [0, 1], digit: '1' }],
  });
  assert.equal(secretSuffix('main'), ''); assert.equal(secretSuffix('c-work'), '_C_WORK');
  const w = JSON.parse(wakeJson(s, false));
  assert.equal(w.windowMinutes, 20);
  assert.equal(w.keys[0].connection, ''); assert.equal(w.keys[1].connection, 'c_work');   // wake.py: _ + upper = _C_WORK
  assert.equal(JSON.parse(wakeJson(s, true)).windowMinutes, 35);
  const pub = workflowYml(s, false), priv = workflowYml(s, true);
  assert.match(pub, /cron: '\*\/10 \* \* \* \*'/); assert.match(priv, /cron: '\*\/30 \* \* \* \*'/);
  assert.match(pub, /CLAUDE_FIRE_TOKEN_C_WORK: \$\{\{ secrets\.CLAUDE_FIRE_TOKEN_C_WORK \}\}/);
  assert.match(pub, /CLAUDE_FIRE_URL: \$\{\{ secrets\.CLAUDE_FIRE_URL \}\}/);
});

test('סנכרון: קבצים מועלים, Secrets מוצפנים ורק כשהשתנו', async () => {
  const kp = nacl.box.keyPair();
  const files = {}, secrets = {}, calls = [];
  const fakeFetch = async (url, o) => {
    const path = url.replace(/^https:\/\/api\.github\.com/, '');
    calls.push(o.method + ' ' + path);
    const res = (status, j) => ({ status, text: async () => JSON.stringify(j) });
    if (path === '/repos/u/r/actions/secrets/public-key') return res(200, { key: Buffer.from(kp.publicKey).toString('base64'), key_id: 'k1' });
    const sec = /\/actions\/secrets\/(\w+)$/.exec(path);
    if (sec && o.method === 'PUT') { secrets[sec[1]] = openSealedBox(JSON.parse(o.body).encrypted_value, kp.publicKey, kp.secretKey); return res(201, {}); }
    const f = /\/contents\/(.+)$/.exec(path);
    if (f && o.method === 'GET') return files[f[1]] ? res(200, { sha: 'x', content: files[f[1]] }) : res(404, {});
    if (f && o.method === 'PUT') { files[f[1]] = JSON.parse(o.body).content; return res(201, {}); }
    return res(404, {});
  };
  const gh = new GitHub('tok', { fetchImpl: fakeFetch });
  const s = applySettings(defaultSettings(), { connections: [{ id: 'main', name: 'א', fireUrl: URL_OK, token: 'sk-1' }] });
  const sent = await syncRepo(gh, { repo: 'u/r', isPrivate: false, settings: s });
  assert.deepEqual(Object.keys(files).sort(), ['.github/workflows/claude-wake.yml', 'wake.json', 'wake.py']);
  assert.deepEqual(secrets, { CLAUDE_FIRE_URL: URL_OK, CLAUDE_FIRE_TOKEN: 'sk-1' });
  const before = calls.length;
  await syncRepo(gh, { repo: 'u/r', isPrivate: false, settings: s, tokensSent: sent });
  const again = calls.slice(before);
  assert.ok(!again.some(c => c.startsWith('PUT')), 'בלי שינוי: אין כתיבה, לא לקבצים ולא ל-Secrets');
});

test('שגיאות הרשאה ברורות', async () => {
  const gh = new GitHub('tok', { fetchImpl: async () => ({ status: 403, text: async () => '{"message":"Resource not accessible by personal access token"}' }) });
  await assert.rejects(gh.user(), { code: 'GH_PERM' });
  const gh2 = new GitHub('tok', { fetchImpl: async () => ({ status: 401, text: async () => '{}' }) });
  await assert.rejects(gh2.user(), { code: 'GH_AUTH' });
});

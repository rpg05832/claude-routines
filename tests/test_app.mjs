// בדיקות לתוכנה במחשב: פענוח פלט clasp, הכנת קבצי הסקריפט, ותקשורת עם הסקריפט. הרצה: node --test tests/test_app.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

process.env.CLAUDE_WAKE_DATA = mkdtempSync(join(tmpdir(), 'cw-test-'));
process.env.CLAUDE_WAKE_SCRIPT_SRC = fileURLToPath(new URL('../src', import.meta.url));
const google = await import('../app/lib/google.mjs');
const { callRemote } = await import('../app/lib/remote.mjs');
const store = await import('../app/lib/store.mjs');
const settingsMod = await import('../app/lib/settings.mjs');

test('פענוח פלט של clasp', () => {
  assert.equal(google.deploymentIdFrom('Deployed AKfycbxABCDEFGHIJKLMNOPQRSTUVWXYZ_-12 @3'), 'AKfycbxABCDEFGHIJKLMNOPQRSTUVWXYZ_-12');
  assert.equal(google.deploymentIdFrom('nothing'), '');
  assert.equal(google.explainClaspError('User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings').code, 'API_DISABLED');
  assert.equal(google.explainClaspError('No credentials found.').code, 'NOT_LOGGED_IN');
  assert.equal(google.explainClaspError('request to https://script.googleapis.com failed, reason: self-signed certificate in certificate chain').code, 'NETWORK');
  assert.equal(google.execUrlFor('AKfycbX'), 'https://script.google.com/macros/s/AKfycbX/exec');
});

test('קבצי הסקריפט שעולים לגוגל: הקוד, המניפסט והמפתח, ובלי שאריות', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-proj-'));
  writeFileSync(join(dir, 'Code.js'), '// ברירת המחדל של גוגל');
  writeFileSync(join(dir, '.clasp.json'), '{"scriptId":"x"}');
  google.writeProjectFiles('a'.repeat(32), settingsMod.applySettings(settingsMod.defaultSettings(), {}), { dir });
  assert.deepEqual(readdirSync(dir).sort(), ['.clasp.json', 'Code.gs', 'Config.gs', 'Secrets.gs', 'appsscript.json']);
  assert.match(readFileSync(join(dir, 'Secrets.gs'), 'utf8'), /var ADMIN_KEY = 'a{32}';/);
  assert.equal(google.scriptVersionOf(), '1.1.0');
  assert.match(readFileSync(join(dir, 'Config.gs'), 'utf8'), /var CONFIG = /);
});

test('מפתח ניהול נוצר פעם אחת ונשמר', () => {
  const k = store.ensureAdminKey();
  assert.match(k, /^[0-9a-f]{32}$/);
  assert.equal(store.ensureAdminKey(), k);
});

const res = (status, text) => ({ status, text: async () => text });

test('תקשורת עם הסקריפט: הצלחה, הרשאות חסרות ושגיאות', async () => {
  let sent;
  const ok = await callRemote('https://x/exec', 'key', 'state', { a: 1 }, { fetchImpl: async (u, o) => { sent = JSON.parse(o.body); return res(200, '{"ok":true,"result":{"v":1}}'); } });
  assert.deepEqual(ok, { v: 1 });
  assert.deepEqual(sent, { a: 'key', op: 'state', args: { a: 1 } });
  await assert.rejects(callRemote('https://x/exec', 'k', 'ping', {}, { fetchImpl: async () => res(200, '<title>Authorization is required to perform that action.</title>') }), { code: 'NEEDS_AUTH' });
  await assert.rejects(callRemote('https://x/exec', 'k', 'ping', {}, { fetchImpl: async () => res(200, '{"ok":false,"error":"NO_ACCESS"}') }), { code: 'NO_ACCESS' });
  await assert.rejects(callRemote('https://x/exec', 'k', 'save', {}, { fetchImpl: async () => res(200, '{"ok":false,"error":"שעה לא תקינה"}') }), /שעה לא תקינה/);
  await assert.rejects(callRemote('https://x/exec', 'k', 'ping', {}, { fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); } }), { code: 'NETWORK' });
  await assert.rejects(callRemote('', 'k', 'ping'), { code: 'NOT_DEPLOYED' });
});

test('חסימה של נטפרי מזוהה', async () => {
  await assert.rejects(callRemote('https://x/exec', 'k', 'ping', {}, { fetchImpl: async () => res(418, '<html>blockByNetFree</html>') }), { code: 'BLOCKED' });
});

test('מצב מקומי: מעבר מגרסה 1.0 ושמירה חלקית', () => {
  const f = join(process.env.CLAUDE_WAKE_DATA, 'old.json');
  writeFileSync(f, JSON.stringify({ scriptId: 'S1', execUrl: 'https://x/exec', adminKey: 'b'.repeat(32), wizardDone: true }));
  const l = store.loadLocal(f);
  assert.equal(l.mode, 'google'); assert.equal(l.google.scriptId, 'S1'); assert.equal(l.google.adminKey, 'b'.repeat(32));
  store.saveLocal({ claude: { envId: 'env1' } }, f);
  const l2 = store.loadLocal(f);
  assert.equal(l2.claude.envId, 'env1'); assert.deepEqual(l2.claude.routines, {}, 'שדות אחרים נשמרים');
});

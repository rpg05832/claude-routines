// בדיקות לסקריפט שבענן (Code.gs): טוען אותו עם הדמיה של שירותי גוגל. הרצה: node --test tests/test_gas.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeEnv, URL_OK, KEY } from './gas-harness.mjs';

function setup(env, yemot = {}) {
  const r = env.admin('save', {
    connections: [{ id: 'c1', name: 'ראשי', fireUrl: URL_OK, token: 'sk-tok' }],
    keys: [{ digit: '1', name: 'הדלקת קלוד', connectionId: 'c1', text: 'בוקר טוב', confirm: 'נשלח' }, { digit: '2', name: 'דוח', connectionId: 'c1', text: 'דוח', confirm: '' }],
    schedules: [{ enabled: true, time: '07:10', days: [0, 1, 2, 3, 4], digit: '1' }],
    yemot: { token: 'ytok', extension: '8', greeting: 'שלום', allowedPhones: '', ...yemot },
  });
  assert.ok(r.ok, r.error);
  return JSON.parse(env.store.config);
}
const yem = (env, p) => env.g.doGet({ parameter: p }).text;
const fires = env => env.fetches.filter(f => f.url === URL_OK).length;

test('תפריט טלפון, הקשה ושליחה לקלוד', () => {
  const env = makeEnv(); const cfg = setup(env);
  const k = cfg.yemot.key;
  const menu = yem(env, { k, ApiPhone: '0501234567', ApiCallId: 'c1' });
  assert.match(menu, /^read=t-שלום להדלקת קלוד הקישו 1 לדוח הקישו 2=cw_choice,no,1,1,10,NO,no,no,,,,,,,no$/);
  assert.equal(yem(env, { k, ApiPhone: '0501234567', ApiCallId: 'c1', cw_choice: '1' }), 'id_list_message=t-נשלח&go_to_folder=hangup');
  const fire = env.fetches.find(f => f.url === URL_OK);
  assert.equal(fire.o.headers.Authorization, 'Bearer sk-tok');
  assert.equal(fire.o.headers['anthropic-beta'], 'experimental-cc-routine-2026-04-01');
  assert.deepEqual(JSON.parse(fire.o.payload), { text: 'בוקר טוב' });
  yem(env, { k, ApiPhone: '0501234567', ApiCallId: 'c1', cw_choice: '1' });
  assert.equal(fires(env), 1, 'אותו צעד שנשלח שוב מימות לא שולח פעמיים');
  assert.equal(yem(env, { k, hangup: 'yes' }), '');
});

test('מפתח שלוחה שגוי, טלפון לא מורשה, קוד כניסה', () => {
  const env = makeEnv(); const cfg = setup(env, { allowedPhones: '050-1234567', pin: '4321' });
  const k = cfg.yemot.key;
  assert.match(yem(env, { k: 'wrong' }), /אין גישה/);
  assert.match(yem(env, { k, ApiPhone: '0529999999' }), /אינו מורשה.*hangup/);
  assert.match(yem(env, { k, ApiPhone: '972501234567' }), /=cw_pin,no,8,4,10,NO/);
  assert.match(yem(env, { k, ApiPhone: '0501234567', cw_pin: '1111' }), /הקוד שגוי/);
  assert.match(yem(env, { k, ApiPhone: '0501234567', cw_pin: '4321' }), /=cw_choice/);
  assert.equal(fires(env), 0);
});

test('תזמון לפי שעון ישראל, פעם אחת ביום', () => {
  const env = makeEnv({ now: new Date('2026-10-25T05:12:00Z') }); // ראשון 07:12, אחרי המעבר לשעון חורף
  setup(env);
  assert.equal(env.triggers.length, 1, 'טריגר דקה נוצר כשיש תזמון פעיל');
  env.g.tick(); env.g.tick();
  assert.equal(fires(env), 1);
  const early = makeEnv({ now: new Date('2026-10-25T04:12:00Z') }); // 06:12
  setup(early); early.g.tick();
  assert.equal(fires(early), 0);
});

test('ממשק ניהול: בלי מפתח אין גישה, וטוקנים לא יוצאים', () => {
  const env = makeEnv(); setup(env);
  for (const a of ['', 'x', 'k'.repeat(31), null]) assert.deepEqual(env.admin('state', {}, a), { ok: false, error: 'NO_ACCESS' });
  const s = env.admin('state');
  assert.ok(s.ok);
  const txt = JSON.stringify(s);
  assert.ok(!txt.includes('sk-tok') && !txt.includes('ytok'));
  assert.match(s.result.yemot.apiLink, /\/exec\?k=[0-9a-f]{24}$/);
  assert.equal(env.admin('ping').result.version, '1.0.0');
  assert.match(env.admin('nope').error, /לא מוכרת/);
});

test('שמירה: אימות קלט, טוקן נשמר, שדות חלקיים', () => {
  const env = makeEnv(); setup(env);
  assert.match(env.admin('save', { connections: [{ id: 'x', name: 'רע', fireUrl: 'https://evil.example/fire', token: 't' }] }).error, /לא נראית/);
  assert.match(env.admin('save', { keys: [{ digit: '1' }, { digit: '1' }] }).error, /פעמיים/);
  assert.match(env.admin('save', { schedules: [{ time: '07:00', digit: '7', days: [1] }] }).error, /מקש שלא קיים/);
  env.admin('save', { connections: [{ id: 'c1', name: 'ראשי', fireUrl: URL_OK, token: '' }] });
  const cfg = JSON.parse(env.store.config);
  assert.equal(cfg.connections[0].token, 'sk-tok', 'שמירה בלי טוקן משאירה את הקיים');
  assert.equal(cfg.keys.length, 2, 'שדה שלא נשלח לא נמחק');
  env.admin('save', { schedules: [] });
  assert.equal(env.triggers.length, 0, 'בלי תזמונים פעילים הטריגר נמחק');
});

test('חיבור השלוחה בימות ושגיאת קלוד', () => {
  const env = makeEnv({ fireCode: 401 }); const cfg = setup(env);
  assert.ok(env.admin('connectYemot').result.ok);
  const body = JSON.parse(env.fetches.find(f => f.url.endsWith('/UpdateExtension')).o.payload);
  assert.equal(body.path, 'ivr2:8'); assert.equal(body.type, 'api');
  assert.equal(body.api_link, 'https://script.google.com/macros/s/ABC/exec?k=' + cfg.yemot.key);
  const res = env.admin('fire', { digit: '1' }).result;
  assert.equal(res.ok, false); assert.match(res.message, /הטוקן/);
  assert.match(yem(env, { k: cfg.yemot.key, ApiCallId: 'z', cw_choice: '1' }), /השליחה נכשלה/);
  const old = cfg.yemot.key;
  assert.notEqual(env.admin('rotateYemotKey').result.yemot.apiLink.split('k=')[1], old);
});

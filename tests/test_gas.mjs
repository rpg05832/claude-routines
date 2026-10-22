// בדיקות לגרסת Apps Script: טוען את Code.gs עם הדמיה של שירותי גוגל. הרצה: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const SRC = readFileSync(new URL('../src/Code.gs', import.meta.url), 'utf8');
const URL_OK = 'https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire';

function makeEnv({ now = new Date('2026-10-25T04:12:00Z'), fireCode = 200 } = {}) {
  const store = {}, cache = {}, triggers = [], fetches = [];
  const tzParts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d).map(p => [p.type, p.value]));
  const ctx = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate(d, tz, f) {
        const p = tzParts(d);
        const dow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
        return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute)
          .replace(/^u$/, String(dow)).replace(/^H$/, String(Number(p.hour))).replace(/^m$/, String(Number(p.minute)));
      },
      computeDigest: (_a, s) => [...crypto.createHash('sha256').update(s).digest()],
      base64Encode: b => Buffer.from(b).toString('base64'),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    },
    UrlFetchApp: {
      fetch(url, o) {
        fetches.push({ url, o });
        if (url.includes('call2all')) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ responseStatus: 'OK', units: 50 }) };
        return { getResponseCode: () => fireCode, getContentText: () => JSON.stringify({ claude_code_session_url: 'https://claude.ai/code/session_1' }) };
      },
    },
    ContentService: { createTextOutput: s => ({ text: s, setMimeType() { return this; } }), MimeType: { TEXT: 'text' } },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, html: true }) },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/ABC/exec' }),
      getProjectTriggers: () => triggers,
      newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) }),
      deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
    },
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now.getTime(); } },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { g: ctx, store, fetches, triggers };
}

function setup(env, extra = {}) {
  const { g } = env;
  g.apiSetPassword('', 'secret1');
  g.apiSave('secret1', {
    connections: [{ id: 'c1', name: 'ראשי', fireUrl: URL_OK, token: 'sk-tok' }],
    keys: [{ digit: '1', name: 'הדלקת קלוד', connectionId: 'c1', text: 'בוקר טוב', confirm: 'נשלח' }, { digit: '2', name: 'דוח', connectionId: 'c1', text: 'דוח', confirm: '' }],
    schedules: [{ enabled: true, time: '07:10', days: [0, 1, 2, 3, 4], digit: '1' }],
    yemot: { token: 'ytok', extension: '8', greeting: 'שלום', allowedPhones: '', ...extra },
  });
  return JSON.parse(env.store.config);
}
const yem = (env, p) => env.g.doGet({ parameter: p }).text;

test('תפריט טלפון, הקשה ושליחה לקלוד', () => {
  const env = makeEnv(); const cfg = setup(env);
  const k = cfg.yemot.key;
  const menu = yem(env, { k, ApiPhone: '0501234567', ApiCallId: 'c1' });
  assert.match(menu, /^read=t-שלום להדלקת קלוד הקישו 1 לדוח הקישו 2=cw_choice,no,1,1,10,NO,no,no,,,,,,,no$/);
  const out = yem(env, { k, ApiPhone: '0501234567', ApiCallId: 'c1', cw_choice: '1' });
  assert.equal(out, 'id_list_message=t-נשלח&go_to_folder=hangup');
  const fire = env.fetches.find(f => f.url === URL_OK);
  assert.equal(fire.o.headers.Authorization, 'Bearer sk-tok');
  assert.equal(fire.o.headers['anthropic-beta'], 'experimental-cc-routine-2026-04-01');
  assert.deepEqual(JSON.parse(fire.o.payload), { text: 'בוקר טוב' });
  // אותו צעד שנשלח שוב מימות לא שולח פעמיים
  yem(env, { k, ApiPhone: '0501234567', ApiCallId: 'c1', cw_choice: '1' });
  assert.equal(env.fetches.filter(f => f.url === URL_OK).length, 1);
  assert.equal(yem(env, { k, hangup: 'yes' }), '');
});

test('מפתח שגוי, טלפון לא מורשה, קוד כניסה', () => {
  const env = makeEnv(); const cfg = setup(env, { allowedPhones: '050-1234567', pin: '4321' });
  const k = cfg.yemot.key;
  assert.match(yem(env, { k: 'wrong' }), /אין גישה/);
  assert.match(yem(env, { k, ApiPhone: '0529999999' }), /אינו מורשה.*hangup/);
  assert.match(yem(env, { k, ApiPhone: '972501234567' }), /=cw_pin,no,8,4,10,NO/);
  assert.match(yem(env, { k, ApiPhone: '0501234567', cw_pin: '1111' }), /הקוד שגוי/);
  assert.match(yem(env, { k, ApiPhone: '0501234567', cw_pin: '4321' }), /=cw_choice/);
  assert.equal(env.fetches.filter(f => f.url === URL_OK).length, 0);
});

test('תזמון לפי שעון ישראל, פעם אחת ביום', () => {
  const env = makeEnv({ now: new Date('2026-10-25T05:12:00Z') }); // ראשון 07:12, אחרי מעבר לשעון חורף
  setup(env);
  assert.equal(env.triggers.length, 1, 'טריגר דקה נוצר כשיש תזמון פעיל');
  env.g.tick(); env.g.tick();
  assert.equal(env.fetches.filter(f => f.url === URL_OK).length, 1);
  const early = makeEnv({ now: new Date('2026-10-25T04:12:00Z') }); // 06:12
  setup(early); early.g.tick();
  assert.equal(early.fetches.filter(f => f.url === URL_OK).length, 0);
});

test('אבטחה: טוקנים לא חוזרים לדפדפן, כתובת זרה נדחית, סיסמה', () => {
  const env = makeEnv(); setup(env);
  const s = JSON.stringify(env.g.apiState('secret1'));
  assert.ok(!s.includes('sk-tok') && !s.includes('ytok'));
  assert.match(s, /\?k=/);
  assert.throws(() => env.g.apiState('nope'), /סיסמה שגויה/);
  assert.throws(() => env.g.apiSave('secret1', { connections: [{ id: 'x', name: 'רע', fireUrl: 'https://evil.example/fire', token: 't' }], keys: [], schedules: [], yemot: {} }), /לא נראית/);
  // שמירה בלי טוקן משאירה את הקיים
  env.g.apiSave('secret1', { connections: [{ id: 'c1', name: 'ראשי', fireUrl: URL_OK, token: '' }], keys: [{ digit: '1', name: 'a', connectionId: 'c1', text: 't' }], schedules: [], yemot: { extension: '8' } });
  assert.equal(JSON.parse(env.store.config).connections[0].token, 'sk-tok');
  assert.equal(env.triggers.length, 0, 'בלי תזמונים פעילים הטריגר נמחק');
  for (let i = 0; i < 5; i++) assert.throws(() => env.g.apiState('bad'));
  assert.throws(() => env.g.apiState('secret1'), /יותר מדי ניסיונות/);
});

test('חיבור השלוחה בימות ושגיאת קלוד', () => {
  const env = makeEnv({ fireCode: 401 }); const cfg = setup(env);
  const r = env.g.apiConnectYemot('secret1');
  assert.ok(r.ok);
  const upd = env.fetches.find(f => f.url.endsWith('/UpdateExtension'));
  const body = JSON.parse(upd.o.payload);
  assert.equal(body.path, 'ivr2:8'); assert.equal(body.type, 'api');
  assert.equal(body.api_link, 'https://script.google.com/macros/s/ABC/exec?k=' + cfg.yemot.key);
  const res = env.g.apiFireNow('secret1', '1');
  assert.equal(res.ok, false); assert.match(res.message, /הטוקן/);
  assert.match(yem(env, { k: cfg.yemot.key, ApiCallId: 'z', cw_choice: '1' }), /השליחה נכשלה/);
});

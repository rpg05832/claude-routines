// בדיקות לסקריפט שבענן (Code.gs) עם ההגדרות מ-Config.gs, בהדמיה של שירותי גוגל. הרצה: node --test tests/test_gas.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeEnv, URL_OK, KEY } from './gas-harness.mjs';
import { applySettings, defaultSettings, configGs } from '../app/lib/settings.mjs';

/** ההגדרות כמו שהתוכנה מעלה אותן: דרך configGs, כדי לבדוק את הקובץ האמיתי. */
function configFor(yemot = {}) {
  const s = applySettings(defaultSettings(), {
    connections: [{ id: 'c1', name: 'ראשי', fireUrl: URL_OK, token: 'sk-tok' }],
    keys: [{ digit: '1', name: 'הדלקת קלוד', connectionId: 'c1', text: 'בוקר טוב', confirm: 'נשלח' }, { digit: '2', name: 'דוח', connectionId: 'c1', text: 'דוח', confirm: '' }],
    schedules: [{ enabled: true, time: '07:10', days: [0, 1, 2, 3, 4], digit: '1' }],
    yemot: { token: 'ytok', extension: '8', greeting: 'שלום', allowedPhones: '', ...yemot },
  });
  const ctx = {}; vm.createContext(ctx); vm.runInContext(configGs(s), ctx);
  return ctx.CONFIG;
}
const yem = (env, p) => env.g.doGet({ parameter: p }).text;
const fires = env => env.fetches.filter(f => f.url === URL_OK).length;

test('תפריט טלפון, הקשה ושליחה לקלוד', () => {
  const config = configFor(); const env = makeEnv({ config });
  const k = config.yemot.key;
  assert.match(yem(env, { k, ApiPhone: '0501234567', ApiCallId: 'c1' }), /^read=t-שלום להדלקת קלוד הקישו 1 לדוח הקישו 2=cw_choice,no,1,1,10,NO,no,no,,,,,,,no$/);
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
  const config = configFor({ allowedPhones: '050-1234567', pin: '4321' }); const env = makeEnv({ config });
  const k = config.yemot.key;
  assert.match(yem(env, { k: 'wrong' }), /אין גישה/);
  assert.match(yem(env, { k, ApiPhone: '0529999999' }), /אינו מורשה.*hangup/);
  assert.match(yem(env, { k, ApiPhone: '972501234567' }), /=cw_pin,no,8,4,10,NO/);
  assert.match(yem(env, { k, ApiPhone: '0501234567', cw_pin: '1111' }), /הקוד שגוי/);
  assert.match(yem(env, { k, ApiPhone: '0501234567', cw_pin: '4321' }), /=cw_choice/);
  assert.equal(fires(env), 0);
});

test('תזמון לפי שעון ישראל, פעם אחת ביום', () => {
  const env = makeEnv({ now: new Date('2026-10-25T05:12:00Z'), config: configFor() }); // ראשון 07:12, אחרי המעבר לשעון חורף
  env.g.tick(); env.g.tick();
  assert.equal(fires(env), 1);
  const early = makeEnv({ now: new Date('2026-10-25T04:12:00Z'), config: configFor() }); // 06:12
  early.g.tick();
  assert.equal(fires(early), 0);
});

test('הטריגר נוצר באישור ההרשאות ובקריאה הראשונה מבחוץ', () => {
  const env = makeEnv({ config: configFor() });
  assert.equal(env.triggers.length, 0);
  env.g.authorize();
  assert.equal(env.triggers.length, 1);
  env.g.authorize();
  assert.equal(env.triggers.length, 1, 'לא נוצר טריגר כפול');
  const env2 = makeEnv({ config: configFor() });
  yem(env2, { k: 'x' });
  assert.equal(env2.triggers.length, 1, 'קריאה מימות מוודאת שהטריגר קיים');
});

test('ממשק לתוכנה: מפתח בלבד, יומן, ובלי פעולות שינוי', () => {
  const config = configFor(); const env = makeEnv({ config });
  for (const a of ['', 'x', 'k'.repeat(31), null]) assert.deepEqual(env.admin('ping', {}, a), { ok: false, error: 'NO_ACCESS' });
  assert.equal(env.admin('ping').result.version, '1.1.0');
  yem(env, { k: config.yemot.key, ApiCallId: 'z', cw_choice: '1' });
  const log = env.admin('log').result;
  assert.equal(log.length, 1); assert.match(log[0].detail, /נשלח/);
  assert.ok(!JSON.stringify(log).includes('sk-tok'));
  for (const op of ['save', 'fire', 'connectYemot', 'state']) assert.match(env.admin(op).error, /לא מוכרת/);
});

test('שגיאת קלוד מוקראת בטלפון', () => {
  const config = configFor(); const env = makeEnv({ fireCode: 401, config });
  assert.match(yem(env, { k: config.yemot.key, ApiCallId: 'z', cw_choice: '1' }), /השליחה נכשלה.*הטוקן/);
});

test('בלי Config.gs הסקריפט לא קורס', () => {
  const env = makeEnv();
  assert.match(yem(env, { k: 'x' }), /אין גישה/);
  env.g.tick();
  assert.equal(KEY.length, 32);
});

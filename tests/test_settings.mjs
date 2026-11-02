// בדיקות למודול ההגדרות. הרצה: node --test tests/test_settings.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { applySettings, defaultSettings, publicSettings, configGs, utcCron, israelOffsetMinutes, nextDstChange } from '../app/lib/settings.mjs';

const URL_OK = 'https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire';

test('אימות ומיזוג הגדרות', () => {
  let c = applySettings(defaultSettings(), { connections: [{ id: 'main', name: 'ראשי', fireUrl: URL_OK, token: 'sk-1' }] });
  assert.equal(c.connections[0].token, 'sk-1');
  assert.match(c.yemot.key, /^[0-9a-f]{24}$/, 'מפתח שלוחה נוצר');
  const key = c.yemot.key;
  c = applySettings(c, { connections: [{ id: 'main', name: 'ראשי', fireUrl: URL_OK, token: '' }] });
  assert.equal(c.connections[0].token, 'sk-1', 'טוקן ריק משאיר את הקיים');
  assert.equal(c.yemot.key, key, 'המפתח לא מתחלף');
  assert.throws(() => applySettings(c, { connections: [{ name: 'x', fireUrl: 'https://evil.example/fire' }] }), /לא נראית/);
  assert.throws(() => applySettings(c, { keys: [{ digit: '1' }, { digit: '1' }] }), /פעמיים/);
  assert.throws(() => applySettings(c, { schedules: [{ time: '25:00', digit: '1', days: [1] }] }), /שעה לא תקינה/);
  assert.throws(() => applySettings(c, { schedules: [{ time: '07:00', digit: '1', days: [] }] }), /אף יום/);
  c = applySettings(c, { schedules: [{ time: '7:05', digit: '1', days: [3, 1, 1], enabled: true }], yemot: { allowedPhones: '050-1234567, +972521234567', pin: '1234' } });
  assert.equal(c.schedules[0].time, '07:05');
  assert.deepEqual(c.schedules[0].days, [1, 3]);
  assert.deepEqual(c.yemot.allowedPhones, ['0501234567', '0521234567']);
  assert.throws(() => applySettings(c, { yemot: { pin: '12' } }), /4 עד 8/);
});

test('לממשק לא יוצאים טוקנים', () => {
  const c = applySettings(defaultSettings(), { connections: [{ id: 'main', name: 'א', fireUrl: URL_OK, token: 'sk-secret' }], yemot: { token: 'y-secret', pin: '4321' } });
  const s = JSON.stringify(publicSettings(c));
  assert.ok(!s.includes('sk-secret') && !s.includes('y-secret') && !s.includes('4321'));
});

test('Config.gs הוא JavaScript תקין, עם טוקן ימות לקריאת היומן', () => {
  const c = applySettings(defaultSettings(), { connections: [{ id: 'main', name: 'א</script>', fireUrl: URL_OK, token: 'sk-1' }], yemot: { token: 'y-secret' } });
  const src = configGs(c, '2026-10-22T10:00:00Z');
  const ctx = {}; vm.createContext(ctx); vm.runInContext(src, ctx);
  assert.equal(ctx.CONFIG.connections[0].token, 'sk-1');
  assert.equal(ctx.CONFIG.connections[0].name, 'א</script>');
  assert.equal(ctx.CONFIG.savedAt, '2026-10-22T10:00:00Z');
  assert.equal(ctx.CONFIG.yemot.token, 'y-secret', 'הסקריפט קורא את יומן הכניסות של ימות');
});

test('המרה לשעון UTC, כולל שעון קיץ וחורף ומעבר יום', () => {
  const summer = new Date('2026-10-20T12:00:00Z'), winter = new Date('2026-11-01T12:00:00Z');
  assert.equal(israelOffsetMinutes(summer), 180);
  assert.equal(israelOffsetMinutes(winter), 120);
  assert.equal(utcCron('07:10', [0, 1, 2, 3, 4], summer), '10 4 * * 0,1,2,3,4');
  assert.equal(utcCron('07:10', [0, 1, 2, 3, 4], winter), '10 5 * * 0,1,2,3,4');
  // 01:30 ביום ראשון בישראל = 22:30 בשבת ב-UTC בקיץ
  assert.equal(utcCron('01:30', [0], summer), '30 22 * * 6');
  assert.equal(utcCron('12:00', [0, 1, 2, 3, 4, 5, 6], summer), '0 9 * * *');
  const ch = nextDstChange(summer);
  assert.equal(ch.toISOString().slice(0, 10), '2026-10-24');   // שעון חורף 2026: מוצאי שבת 25.10 בלילה (UTC: 24.10)
});

test('קבצי שלוחת התפריט בימות', async () => {
  const { yemotFiles } = await import('../app/lib/direct.mjs');
  const s = applySettings(defaultSettings(), {
    keys: [{ digit: '1', name: 'הדלקת קלוד', connectionId: 'c', text: 'x', confirm: 'נשלח\nלקלוד' }, { digit: '3', name: '', connectionId: 'c', text: 'y', confirm: '' }],
    yemot: { token: 't', extension: '/8/', greeting: 'שלום', pin: '1234', allowedPhones: '050-1234567' },
  });
  const f = Object.fromEntries(yemotFiles(s).map(x => [x.what, x.contents]));
  assert.equal(f['ivr2:8/ext.ini'], 'type=menu\npassword=1234\npassword_error_goto=hangup\nwhite_list=yes\nwhite_list_error_goto=hangup\n');
  assert.equal(f['ivr2:8/M1000.tts'], 'שלום להדלקת קלוד הקישו 1 למקש 3 הקישו 3');
  assert.equal(f['ivr2:8/WhiteList.ini'], '0501234567\n');
  assert.equal(f['ivr2:8/1/ext.ini'], 'type=playfile\nplayfile_end_goto=hangup\n');
  assert.equal(f['ivr2:8/1/000.tts'], 'נשלח לקלוד');
  assert.match(f['ivr2:8/3/000.tts'], /תוך דקה/);
  const plain = Object.fromEntries(yemotFiles(applySettings(s, { yemot: { clearPin: true, allowedPhones: '' } })).map(x => [x.what, x.contents]));
  assert.equal(plain['ivr2:8/ext.ini'], 'type=menu\n');
  assert.ok(!('ivr2:8/WhiteList.ini' in plain));
});

test('חיבור ימות: התיקיות נוצרות לפני העלאת הקבצים', async () => {
  const { connectYemot } = await import('../app/lib/direct.mjs');
  const s = applySettings(defaultSettings(), { yemot: { token: 't', extension: '8' } });
  const calls = [];
  const fetchImpl = async (url, o) => { calls.push(url.split('/').pop() + ' ' + (JSON.parse(o.body).path || JSON.parse(o.body).what || '')); return { status: 200, text: async () => '{"responseStatus":"OK","units":5}' }; };
  await connectYemot({ settings: s }, { fetchImpl });
  assert.deepEqual(calls, ['GetSession ', 'UpdateExtension ivr2:8', 'UpdateExtension ivr2:8/1', 'UploadTextFile ivr2:8/ext.ini', 'UploadTextFile ivr2:8/M1000.tts', 'UploadTextFile ivr2:8/1/ext.ini', 'UploadTextFile ivr2:8/1/000.tts']);
});

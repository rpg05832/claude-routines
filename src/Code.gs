/**
 * הדלקת קלוד (Claude Wake) - Google Apps Script
 *
 * שולח הודעה קבועה לרוטינה של Claude Code בענן:
 *   - מהטלפון: שלוחת API בימות המשיח, תפריט מקשים, הקשה, שליחה
 *   - לפי תזמון: שעות וימים לפי שעון ישראל (טריגר שרץ כל דקה)
 *
 * ההגדרות מגיעות מהקובץ Config.gs (משתנה CONFIG), שתוכנת "הדלקת קלוד" במחשב כותבת ומעלה דרך clasp.
 * קוד המקור, ובו הטוקנים, גלוי רק לבעל הסקריפט.
 */

var SCRIPT_VERSION = '1.1.3';
var FIRE_URL_RE = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/;
var BETA_HEADER = 'experimental-cc-routine-2026-04-01';
var TZ = 'Asia/Jerusalem';
var SCHEDULE_WINDOW_MIN = 20;   // תזמון שהתעכב עד 20 דקות עדיין ירוץ, פעם אחת ביום
var LOG_MAX = 40;

// שירות הבקשות לאינטרנט של גוגל. השם נבנה בזמן ריצה, ולא כתוב במלואו בקוד (ראה בדיקה ב-tests/test_gas.mjs).
// ההרשאה מוגדרת במפורש ב-appsscript.json.
function http_() { return globalThis['Url' + 'FetchApp']; }

/* ===================== הגדרות ===================== */

function props_() { return PropertiesService.getScriptProperties(); }

/** ההגדרות מ-Config.gs, עם ברירות מחדל לשדות חסרים. */
function loadConfig_() {
  var c = (typeof CONFIG === 'object' && CONFIG) ? JSON.parse(JSON.stringify(CONFIG)) : {};
  c.connections = c.connections || [];
  c.keys = c.keys || [];
  c.schedules = c.schedules || [];
  c.yemot = c.yemot || {};
  c.yemot.allowedPhones = c.yemot.allowedPhones || [];
  return c;
}

function addLog_(kind, detail, ok) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e) { return; }
  try {
    var list = JSON.parse(props_().getProperty('log') || '[]');
    list.unshift({ at: Utilities.formatDate(new Date(), TZ, 'dd.MM HH:mm'), kind: kind, detail: String(detail).slice(0, 200), ok: !!ok });
    props_().setProperty('log', JSON.stringify(list.slice(0, LOG_MAX)));
  } finally { lock.releaseLock(); }
}

/* ===================== שליחה לקלוד ===================== */

/** שולח את ההודעה של מקש. מחזיר {ok, message, sessionUrl}. */
function fireKey_(cfg, digit, source) {
  var key = findKey_(cfg, digit);
  if (!key) return { ok: false, message: 'אין מקש ' + digit };
  var conn = findConnection_(cfg, key.connectionId);
  if (!conn || !conn.token || !FIRE_URL_RE.test(conn.fireUrl || '')) {
    addLog_(source, 'מקש ' + digit + ': אין חיבור תקין לקלוד', false);
    return { ok: false, message: 'אין חיבור תקין לקלוד למקש הזה' };
  }
  var res = postFire_(conn.fireUrl, conn.token, key.text);
  addLog_(source, key.name + ' (' + digit + '): ' + res.message, res.ok);
  return res;
}

function postFire_(fireUrl, token, text) {
  try {
    var r = http_().fetch(fireUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token, 'anthropic-beta': BETA_HEADER, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(text ? { text: String(text) } : {}),
      muteHttpExceptions: true,
      followRedirects: false
    });
    var code = r.getResponseCode();
    var body = {};
    try { body = JSON.parse(r.getContentText() || '{}'); } catch (e) { /* לא JSON */ }
    if (code >= 200 && code < 300) return { ok: true, message: 'נשלח', sessionUrl: body.claude_code_session_url || '' };
    if (code === 401 || code === 403) return { ok: false, message: 'הטוקן של הרוטינה לא תקין או נמחק (' + code + ')' };
    if (code === 429) return { ok: false, message: 'יותר מדי הפעלות בשעה האחרונה, או שמכסת השימוש נגמרה (429)' };
    return { ok: false, message: 'קלוד החזיר שגיאה ' + code + (body.error && body.error.message ? ': ' + body.error.message : '') };
  } catch (e) {
    return { ok: false, message: 'החיבור לקלוד נכשל: ' + e.message };
  }
}

function findKey_(cfg, digit) { for (var i = 0; i < cfg.keys.length; i++) if (cfg.keys[i].digit === String(digit)) return cfg.keys[i]; return null; }
function findConnection_(cfg, id) { for (var i = 0; i < cfg.connections.length; i++) if (cfg.connections[i].id === id) return cfg.connections[i]; return null; }

/* ===================== ימות המשיח ===================== */

/** ניקוי טקסט להקראה: תווים ששוברים את פרוטוקול ימות מוחלפים ברווח. */
function san_(t) { return String(t == null ? '' : t).replace(/[,\-=&|"'.\r\n]/g, ' ').replace(/\s+/g, ' ').trim(); }

/**
 * קליטת ספרות, בלי הקראה חוזרת ובלי "לאישור הקישו 1".
 * סדר הערכים לפי https://f2.freeivr.co.il/topic/56 (אותו פורמט שאומת ב-ClaudePhone).
 */
function readDigits_(prompt, name, max, min, timeout) {
  return 'read=t-' + san_(prompt) + '=' + name + ',no,' + max + ',' + min + ',' + timeout + ',NO,no,no,,,,,,,no';
}
function say_(text) { return 'id_list_message=t-' + san_(text); }
function hangup_() { return 'go_to_folder=hangup'; }

function normPhone_(p) {
  var d = String(p || '').replace(/\D/g, '');
  if (d.indexOf('972') === 0) d = '0' + d.slice(3);
  return d;
}

function safeEq_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  var x = 0;
  for (var i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/** מטפל בבקשה אחת של שלוחת ה-API. מחזיר את מחרוזת התשובה לימות. */
function handleYemot_(p, cfg) {
  if (p.hangup === 'yes') return '';
  var y = cfg.yemot;

  var phone = normPhone_(p.ApiPhone);
  var allowed = (y.allowedPhones || []).map(normPhone_).filter(String);
  if (allowed.length && allowed.indexOf(phone) < 0) {
    addLog_('טלפון', 'שיחה ממספר לא מורשה', false);
    return say_('המספר שלך אינו מורשה') + '&' + hangup_();
  }

  if (y.pin) {
    if (!p.cw_pin) return readDigits_('הקישו את הקוד וסולמית', 'cw_pin', 8, 4, 10);
    if (!safeEq_(p.cw_pin, y.pin)) {
      addLog_('טלפון', 'קוד שגוי', false);
      return say_('הקוד שגוי') + '&' + hangup_();
    }
  }

  var keys = cfg.keys.filter(function (k) { return /^[0-9]$/.test(k.digit); });
  if (!keys.length) return say_('לא הוגדרו מקשים') + '&' + hangup_();

  if (!p.cw_choice) {
    var menu = (y.greeting ? y.greeting + ' ' : '') + keys.map(function (k) { return 'ל' + k.name + ' הקישו ' + k.digit; }).join(' ');
    return readDigits_(menu, 'cw_choice', 1, 1, 10);
  }

  var key = findKey_(cfg, p.cw_choice);
  if (!key) return say_('המקש אינו מוגדר') + '&' + hangup_();

  // מניעת כפילות: ימות עשויים לשלוח את אותו צעד פעמיים
  var cache = CacheService.getScriptCache();
  var dedupe = 'fired:' + (p.ApiCallId || phone) + ':' + key.digit;
  var prev = cache.get(dedupe);
  if (prev) return prev;

  var res = fireKey_(cfg, key.digit, 'טלפון');
  var out = (res.ok ? say_(key.confirm || 'ההודעה נשלחה') : say_('השליחה נכשלה ' + res.message)) + '&' + hangup_();
  cache.put(dedupe, out, 600);
  return out;
}

/* ===================== נקודות כניסה ===================== */
/*
 * GET/POST עם k=...   : שלוחת API של ימות המשיח (מפתח סודי בכתובת השלוחה)
 * POST עם גוף JSON    : תוכנת הניהול, כשהכתובת נגישה ממנה: יומן ובדיקת פעולה.
 * GET בלי פרמטרים     : דף קצר שמאשר שהסקריפט פועל.
 */

function doGet(e) { return route_(e); }
function doPost(e) { return route_(e); }

function route_(e) {
  ensureTickerOnce_();
  var p = (e && e.parameter) || {};
  if (p.k !== undefined) return text_(yemotEntry_(p));
  var body = e && e.postData && e.postData.contents;
  if (body && /^\s*\{/.test(body)) {
    var out;
    try { out = { ok: true, result: adminApi_(JSON.parse(body)) }; }
    catch (err) { out = { ok: false, error: err.message }; }
    return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutput('<div dir="rtl" style="font-family:Arial;padding:24px;font-size:18px">הדלקת קלוד פועלת. אפשר לסגור את הדף ולחזור לתוכנה.</div>')
    .setTitle('הדלקת קלוד');
}

/**
 * להרצה פעם אחת: דרך טריגר חד-פעמי (הדרך הראשית באשף) או "הפעלה" בעורך. בשמירת הטריגר או בהפעלה
 * גוגל מבקש לאשר את כל ההרשאות. הפונקציה יוצרת את הטריגר שבודק את התזמונים כל דקה, ומוחקת את
 * הטריגר החד-פעמי שהפעיל אותה.
 */
function authorize() {
  http_().getRequest('https://www.call2all.co.il/ym/api/GetSession');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'authorize') ScriptApp.deleteTrigger(t);
  });
  ensureTicker_();
  props_().setProperty('tickerOk', SCRIPT_VERSION);
  addLog_('הגדרה', 'ההרשאות אושרו והתזמונים פעילים', true);
  Logger.log('ההרשאות אושרו. אפשר לחזור לתוכנה.');
  return 'ההרשאות אושרו';
}

function text_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT); }

function yemotEntry_(p) {
  var cfg = loadConfig_();
  if (!safeEq_(p.k, cfg.yemot.key)) return say_('אין גישה') + '&' + hangup_();
  try { return handleYemot_(p, cfg); }
  catch (err) { addLog_('טלפון', 'תקלה: ' + err.message, false); return say_('תקלה זמנית') + '&' + hangup_(); }
}

/* ===================== תזמונים ===================== */

/** רץ כל דקה (טריגר זמן). כל תזמון רץ פעם אחת ביום, עד 20 דקות אחרי השעה שנקבעה. */
function tick() {
  var cfg = loadConfig_();
  if (!cfg.schedules.length) return;
  var now = new Date();
  var today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  var dow = Number(Utilities.formatDate(now, TZ, 'u')) % 7;   // 0 = ראשון
  var mins = Number(Utilities.formatDate(now, TZ, 'H')) * 60 + Number(Utilities.formatDate(now, TZ, 'm'));
  var fired = JSON.parse(props_().getProperty('fired') || '{}');
  cfg.schedules.forEach(function (s) {
    if (!dueNow_(s, dow, mins) || fired[s.id] === today) return;
    fired[s.id] = today;
    props_().setProperty('fired', JSON.stringify(fired));   // נשמר לפני השליחה: עדיף פספוס על כפילות
    fireKey_(cfg, s.digit, 'תזמון ' + s.time);
  });
}

/** האם תזמון צריך לרוץ עכשיו (יום בשבוע 0-6, דקות מתחילת היום). */
function dueNow_(s, dow, mins) {
  if (!s.enabled || (s.days || []).indexOf(dow) < 0) return false;
  var m = /^(\d{1,2}):(\d{2})$/.exec(s.time || '');
  if (!m) return false;
  var at = Number(m[1]) * 60 + Number(m[2]);
  return mins >= at && mins < at + SCHEDULE_WINDOW_MIN;
}

/** טריגר הדקה קיים תמיד (כשאין תזמונים tick יוצא מיד). */
function ensureTicker_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'tick'; });
  if (!has) ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
}

/** בקריאה הראשונה מבחוץ (ימות או התוכנה) מוודאים שהטריגר קיים, בלי לבדוק בכל קריאה. */
function ensureTickerOnce_() {
  if (props_().getProperty('tickerOk') === SCRIPT_VERSION) return;
  try { ensureTicker_(); props_().setProperty('tickerOk', SCRIPT_VERSION); } catch (e) { /* עוד לא אושרו הרשאות */ }
}

/* ===================== ממשק לתוכנה (כשהכתובת נגישה) ===================== */

function adminKey_() { return typeof ADMIN_KEY === 'string' && ADMIN_KEY.length >= 32 ? ADMIN_KEY : ''; }

function adminApi_(req) {
  var key = adminKey_();
  if (!key || !safeEq_(req.a, key)) throw new Error('NO_ACCESS');
  switch (req.op) {
    case 'ping': return { version: SCRIPT_VERSION, configVersion: (typeof CONFIG === 'object' && CONFIG && CONFIG.savedAt) || '', ticker: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'tick'; }) };
    case 'log': return JSON.parse(props_().getProperty('log') || '[]');
    case 'clearLog': props_().setProperty('log', '[]'); return true;
    default: throw new Error('פעולה לא מוכרת: ' + req.op);
  }
}

/**
 * הדלקת קלוד (Claude Wake) - Google Apps Script
 *
 * שולח הודעה קבועה לרוטינה של Claude Code בענן:
 *   - מהטלפון: שלוחת API בימות המשיח, תפריט מקשים, הקשה, שליחה
 *   - לפי תזמון: שעות וימים לפי שעון ישראל
 *   - מכפתור במסך ההגדרות
 * בלי מחשב דלוק ובלי שרת. הסודות נשמרים ב-Script Properties ולא חוזרים לדפדפן.
 */

var FIRE_URL_RE = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/;
var BETA_HEADER = 'experimental-cc-routine-2026-04-01';
var YEMOT_API = 'https://www.call2all.co.il/ym/api';
var TZ = 'Asia/Jerusalem';
var SCHEDULE_WINDOW_MIN = 20;   // תזמון שהתעכב עד 20 דקות עדיין ירוץ, פעם אחת ביום
var LOG_MAX = 40;

/* ===================== אחסון ===================== */

function props_() { return PropertiesService.getScriptProperties(); }

function defaultConfig_() {
  return {
    connections: [],   // {id, name, fireUrl, token}
    keys: [            // {digit, name, connectionId, text, confirm}
      { digit: '1', name: 'הדלקת קלוד', connectionId: '', text: 'בוקר טוב', confirm: 'ההודעה נשלחה לקלוד' }
    ],
    schedules: [],     // {id, enabled, time:'HH:mm', days:[0..6], digit}
    yemot: { token: '', extension: '', key: '', allowedPhones: [], pin: '', greeting: 'שלום' }
  };
}

function loadConfig_() {
  var raw = props_().getProperty('config');
  var cfg = raw ? JSON.parse(raw) : defaultConfig_();
  var d = defaultConfig_();
  for (var k in d) if (cfg[k] === undefined) cfg[k] = d[k];
  for (var y in d.yemot) if (cfg.yemot[y] === undefined) cfg.yemot[y] = d.yemot[y];
  if (!cfg.yemot.key) { cfg.yemot.key = randomId_(24); saveConfig_(cfg); }
  return cfg;
}

function saveConfig_(cfg) { props_().setProperty('config', JSON.stringify(cfg)); }

function addLog_(kind, detail, ok) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e) { return; }
  try {
    var list = JSON.parse(props_().getProperty('log') || '[]');
    list.unshift({ at: Utilities.formatDate(new Date(), TZ, 'dd.MM HH:mm'), kind: kind, detail: String(detail).slice(0, 200), ok: !!ok });
    props_().setProperty('log', JSON.stringify(list.slice(0, LOG_MAX)));
  } finally { lock.releaseLock(); }
}

function randomId_(n) {
  var s = '';
  while (s.length < n) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, n);
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
    var r = UrlFetchApp.fetch(fireUrl, {
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

function doGet(e) { return route_(e); }
function doPost(e) { return route_(e); }

function route_(e) {
  var p = (e && e.parameter) || {};
  if (p.k !== undefined) {
    var cfg = loadConfig_();
    var body;
    if (!safeEq_(p.k, cfg.yemot.key)) body = say_('אין גישה') + '&' + hangup_();
    else {
      try { body = handleYemot_(p, cfg); }
      catch (err) { addLog_('טלפון', 'תקלה: ' + err.message, false); body = say_('תקלה זמנית') + '&' + hangup_(); }
    }
    return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.TEXT);
  }
  return HtmlService.createHtmlOutputFromFile('Settings')
    .setTitle('הדלקת קלוד')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ===================== תזמונים ===================== */

/** רץ כל דקה (טריגר זמן). כל תזמון רץ פעם אחת ביום, עד 20 דקות אחרי השעה שנקבעה. */
function tick() {
  var cfg = loadConfig_();
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

function ensureTicker_(on) {
  var has = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'tick'; });
  if (on && !has.length) ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  if (!on) has.forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

/* ===================== API למסך ההגדרות ===================== */
/*
 * שתי שכבות:
 * 1. קישור ניהול סודי (?a=...). נוצר רק מתוך עורך הסקריפט (showAdminLink), כך שרק בעל הסקריפט מקבל אותו.
 *    בלי הקישור אי אפשר לבחור סיסמה ראשונה, וניסיונות סיסמה לא נספרים (אין נעילה מבחוץ).
 * 2. סיסמה, שנשמרת כגיבוב. אחרי 5 ניסיונות שגויים עם קישור תקין: חסימה ל-15 דקות.
 * cred = { a: מפתח הקישור, pw: סיסמה }
 */

function hash_(s) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'claude-wake:' + s, Utilities.Charset.UTF_8));
}

function checkAdminKey_(cred) {
  var key = props_().getProperty('adminKey');
  if (!key || !cred || !safeEq_(cred.a, key)) throw new Error('NO_ACCESS');
}

function auth_(cred) {
  checkAdminKey_(cred);
  var p = props_();
  var until = Number(p.getProperty('lockUntil') || 0);
  if (Date.now() < until) throw new Error('יותר מדי ניסיונות. נסה שוב בעוד כמה דקות');
  var h = p.getProperty('adminHash');
  if (!h) throw new Error('NO_PASSWORD');
  if (!safeEq_(hash_(cred.pw), h)) {
    var fails = Number(p.getProperty('fails') || 0) + 1;
    p.setProperty('fails', String(fails));
    if (fails >= 5) { p.setProperty('lockUntil', String(Date.now() + 15 * 60000)); p.setProperty('fails', '0'); }
    throw new Error('סיסמה שגויה');
  }
  p.setProperty('fails', '0');
}

function apiHasPassword(cred) { checkAdminKey_(cred); return !!props_().getProperty('adminHash'); }

function apiSetPassword(cred, newPassword) {
  checkAdminKey_(cred);
  if (String(newPassword || '').length < 6) throw new Error('הסיסמה צריכה לפחות 6 תווים');
  if (props_().getProperty('adminHash')) auth_(cred);
  props_().setProperty('adminHash', hash_(newPassword));
  return true;
}

/* ===== פונקציות להרצה מתוך עורך הסקריפט בלבד (בוחרים בתפריט ולוחצים "הפעלה") ===== */

/** בעל הסקריפט בעורך. בקריאה אנונימית מהאינטרנט אין משתמש פעיל, ולכן זה נכשל. */
function requireEditor_() {
  var me = Session.getActiveUser().getEmail();
  if (!me || me !== Session.getEffectiveUser().getEmail()) throw new Error('להרצה מתוך עורך הסקריפט בלבד');
}

/** מדפיס ביומן (Execution log) את קישור הניהול. יוצר מפתח בפעם הראשונה. */
function showAdminLink() {
  requireEditor_();
  var p = props_();
  if (!p.getProperty('adminKey')) p.setProperty('adminKey', randomId_(32));
  var url = ScriptApp.getService().getUrl();
  Logger.log(url ? 'קישור הניהול (לשמור במועדפים, לא לשתף): ' + url + '?a=' + p.getProperty('adminKey')
    : 'קודם צריך לפרסם: Deploy, New deployment, Web app. אחר כך להריץ שוב.');
}

/** קישור ניהול חדש (הישן מפסיק לעבוד), ואיפוס הסיסמה והנעילה. למקרה שהקישור דלף או שהסיסמה נשכחה. */
function resetAdminAccess() {
  requireEditor_();
  var p = props_();
  p.setProperty('adminKey', randomId_(32));
  p.deleteProperty('adminHash'); p.deleteProperty('lockUntil'); p.setProperty('fails', '0');
  showAdminLink();
}

/** המצב למסך: בלי טוקנים, רק האם הם שמורים. */
function apiState(cred) {
  auth_(cred);
  var cfg = loadConfig_();
  var url = ScriptApp.getService().getUrl() || '';
  return {
    connections: cfg.connections.map(function (c) { return { id: c.id, name: c.name, fireUrl: c.fireUrl, hasToken: !!c.token }; }),
    keys: cfg.keys,
    schedules: cfg.schedules,
    yemot: {
      extension: cfg.yemot.extension, allowedPhones: cfg.yemot.allowedPhones.join(', '), hasPin: !!cfg.yemot.pin,
      greeting: cfg.yemot.greeting, hasToken: !!cfg.yemot.token,
      apiLink: url ? url + '?k=' + cfg.yemot.key : ''
    },
    tickerOn: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'tick'; }),
    log: JSON.parse(props_().getProperty('log') || '[]'),
    webAppUrl: url
  };
}

/** שמירה. טוקן ריק = משאירים את הקיים. */
function apiSave(cred, data) {
  auth_(cred);
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var cfg = loadConfig_();
    applySettings_(cfg, data);
    saveConfig_(cfg);
  } finally { lock.releaseLock(); }
  ensureTicker_(loadConfig_().schedules.some(function (s) { return s.enabled; }));
  return apiState(cred);
}

/** מאמת ומחיל את מה שנשלח מהמסך על ההגדרות. זורק שגיאה בעברית על קלט לא תקין. */
function applySettings_(cfg, data) {
  var oldConn = {}; cfg.connections.forEach(function (c) { oldConn[c.id] = c; });
  cfg.connections = (data.connections || []).map(function (c) {
    var url = String(c.fireUrl || '').trim();
    if (url && !FIRE_URL_RE.test(url)) throw new Error('הכתובת של "' + c.name + '" לא נראית ככתובת הפעלה של רוטינה (https://api.anthropic.com/v1/claude_code/routines/trig_.../fire)');
    var id = c.id || randomId_(8);
    var token = String(c.token || '').trim() || (oldConn[id] && oldConn[id].token) || '';
    return { id: id, name: String(c.name || 'חיבור').slice(0, 40), fireUrl: url, token: token };
  });
  var seen = {};
  cfg.keys = (data.keys || []).map(function (k) {
    var d = String(k.digit || '');
    if (!/^[0-9]$/.test(d)) throw new Error('מקש חייב להיות ספרה אחת');
    if (seen[d]) throw new Error('המקש ' + d + ' מופיע פעמיים');
    seen[d] = 1;
    return { digit: d, name: String(k.name || '').slice(0, 40), connectionId: String(k.connectionId || ''), text: String(k.text || '').slice(0, 2000), confirm: String(k.confirm || '').slice(0, 120) };
  });
  cfg.schedules = (data.schedules || []).map(function (s) {
    if (!/^\d{1,2}:\d{2}$/.test(s.time || '')) throw new Error('שעה לא תקינה: ' + s.time);
    if (!seen[String(s.digit)]) throw new Error('תזמון ' + s.time + ' מפנה למקש שלא קיים');
    return { id: s.id || randomId_(8), enabled: !!s.enabled, time: s.time, days: (s.days || []).map(Number).filter(function (n) { return n >= 0 && n <= 6; }), digit: String(s.digit) };
  });
  var y = data.yemot || {};
  cfg.yemot.extension = String(y.extension || '').replace(/[^0-9/]/g, '').replace(/^\/+|\/+$/g, '');
  cfg.yemot.allowedPhones = String(y.allowedPhones || '').split(/[\s,;]+/).map(normPhone_).filter(String);
  cfg.yemot.greeting = String(y.greeting || '').slice(0, 120);
  if (y.token) cfg.yemot.token = String(y.token).trim();
  if (y.clearToken) cfg.yemot.token = '';
  if (y.pin) {
    if (!/^\d{4,8}$/.test(y.pin)) throw new Error('קוד כניסה: 4 עד 8 ספרות');
    cfg.yemot.pin = y.pin;
  }
  if (y.clearPin) cfg.yemot.pin = '';
  return cfg;
}

function apiFireNow(cred, digit) {
  auth_(cred);
  return fireKey_(loadConfig_(), digit, 'כפתור');
}

function yemotCall_(token, method, body) {
  var payload = { token: token };
  for (var k in body) payload[k] = body[k];
  var r = UrlFetchApp.fetch(YEMOT_API + '/' + method, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(payload)
  });
  var j = {};
  try { j = JSON.parse(r.getContentText()); } catch (e) { /* */ }
  if (j.responseStatus !== 'OK') throw new Error('ימות ' + method + ': ' + (j.responseStatus || 'HTTP ' + r.getResponseCode()) + (j.message ? ' ' + j.message : ''));
  return j;
}

/** בודק את טוקן ימות ומגדיר את השלוחה כשלוחת API שמפנה לכאן. */
function apiConnectYemot(cred) {
  auth_(cred);
  var cfg = loadConfig_();
  if (!cfg.yemot.token) throw new Error('חסר טוקן של ימות');
  if (!cfg.yemot.extension) throw new Error('חסר מספר שלוחה');
  var url = ScriptApp.getService().getUrl();
  if (!url || !/\/exec$/.test(url)) throw new Error('צריך קודם לפרסם את הסקריפט (Deploy, Web app) ולפתוח את המסך מכתובת ה-exec');
  var s = yemotCall_(cfg.yemot.token, 'GetSession', {});
  yemotCall_(cfg.yemot.token, 'UpdateExtension', { path: 'ivr2:' + cfg.yemot.extension, type: 'api', api_link: url + '?k=' + cfg.yemot.key });
  addLog_('ימות', 'שלוחה ' + cfg.yemot.extension + ' חוברה', true);
  return { ok: true, message: 'שלוחה ' + cfg.yemot.extension + ' מחוברת. יחידות במערכת: ' + (s.units == null ? '?' : s.units) };
}

/** מחליף את המפתח הסודי בכתובת השלוחה (אחרי זה צריך לחבר שוב את השלוחה). */
function apiRotateYemotKey(cred) {
  auth_(cred);
  var cfg = loadConfig_(); cfg.yemot.key = randomId_(24); saveConfig_(cfg);
  return apiState(cred);
}

function apiClearLog(cred) { auth_(cred); props_().setProperty('log', '[]'); return true; }

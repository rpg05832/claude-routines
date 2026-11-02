// פעולות ישירות מהמחשב: שליחה לרוטינה ב-claude.ai, והגדרת השלוחה בימות המשיח.
import { FIRE_URL_RE } from './settings.mjs';

export const BETA_HEADER = 'experimental-cc-routine-2026-04-01';
const YEMOT_API = process.env.CLAUDE_WAKE_YEMOT_API || 'https://www.call2all.co.il/ym/api';   // משתנה רק בבדיקות

/** שולח הודעה לרוטינה. מחזיר {ok, message, sessionUrl}. */
export async function fire(fireUrl, token, text, { fetchImpl = fetch } = {}) {
  if (!FIRE_URL_RE.test(fireUrl || '')) return { ok: false, message: 'כתובת ההפעלה לא תקינה' };
  if (!token) return { ok: false, message: 'חסר טוקן לחיבור הזה' };
  try {
    const r = await fetchImpl(fireUrl, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: { authorization: 'Bearer ' + token, 'anthropic-beta': BETA_HEADER, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(text ? { text: String(text) } : {}),
    });
    let body = {};
    try { body = JSON.parse(await r.text()); } catch { /* לא JSON */ }
    if (r.status >= 200 && r.status < 300) return { ok: true, message: 'נשלח', sessionUrl: body.claude_code_session_url || '' };
    if (r.status === 401 || r.status === 403) return { ok: false, message: `הטוקן של הרוטינה לא תקין או נמחק (${r.status})` };
    if (r.status === 429) return { ok: false, message: 'יותר מדי הפעלות בשעה האחרונה, או שמכסת השימוש נגמרה (429)' };
    return { ok: false, message: `קלוד החזיר שגיאה ${r.status}${body.error?.message ? ': ' + body.error.message : ''}` };
  } catch (e) {
    return { ok: false, message: 'החיבור לקלוד נכשל: ' + (e.name === 'TimeoutError' ? 'אין תשובה' : e.message) };
  }
}

async function yemotCall(token, method, body, fetchImpl) {
  let r;
  try {
    r = await fetchImpl(`${YEMOT_API}/${method}`, {
      method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, ...body }),
    });
  } catch (e) { throw new Error('אין חיבור לימות המשיח: ' + e.message); }
  let j = {};
  try { j = JSON.parse(await r.text()); } catch { /* */ }
  if (j.responseStatus !== 'OK') throw new Error(`ימות ${method}: ${j.responseStatus || 'HTTP ' + r.status}${j.message ? ' ' + j.message : ''}`);
  return j;
}

const ttsText = (t) => String(t || '').replace(/\s+/g, ' ').trim();

/**
 * הקבצים של שלוחת התפריט בימות. שלוחת API לא עובדת מול גוגל (הכתובת עונה בהפניה וימות לא ממשיכים
 * אחריה), ולכן השלוחה היא תפריט רגיל: כל מקש עובר לתת-שלוחה שמשמיעה אישור ומנתקת. הסקריפט בגוגל
 * קורא כל דקה את יומן הכניסות לשלוחות (LogFolderEnterExit) ושולח לפי תת-השלוחה.
 */
export function yemotFiles(settings) {
  const y = settings.yemot, e = y.extension;
  const keys = settings.keys.filter(k => /^[0-9]$/.test(k.digit));
  const ini = ['type=menu'];
  if (y.pin) ini.push('password=' + y.pin, 'password_error_goto=hangup');
  if (y.allowedPhones.length) ini.push('white_list=yes', 'white_list_error_goto=hangup');
  const menu = [y.greeting, ...keys.map(k => `ל${k.name || 'מקש ' + k.digit} הקישו ${k.digit}`)].map(ttsText).filter(Boolean).join(' ');
  const lines = (a) => a.join('\n') + '\n';
  const files = [
    { what: `ivr2:${e}/ext.ini`, contents: lines(ini) },
    { what: `ivr2:${e}/M1000.tts`, contents: menu || 'לא הוגדרו מקשים' },
  ];
  if (y.allowedPhones.length) files.push({ what: `ivr2:${e}/WhiteList.ini`, contents: lines(y.allowedPhones) });
  for (const k of keys) {
    files.push({ what: `ivr2:${e}/${k.digit}/ext.ini`, contents: lines(['type=playfile', 'playfile_end_goto=hangup']) });
    files.push({ what: `ivr2:${e}/${k.digit}/000.tts`, contents: ttsText(k.confirm) || 'הבקשה התקבלה. ההודעה תישלח לקלוד תוך דקה' });
  }
  return files;
}

/** בודק את טוקן ימות ומגדיר את שלוחת התפריט (ראה yemotFiles). */
export async function connectYemot({ settings }, { fetchImpl = fetch } = {}) {
  const { token, extension } = settings.yemot;
  if (!token) throw new Error('חסר טוקן של ימות');
  if (!extension) throw new Error('חסר מספר שלוחה');
  const s = await yemotCall(token, 'GetSession', {}, fetchImpl);
  // UploadTextFile לא יוצר תיקייה חדשה, ו-UpdateExtension כן. אחר כך ext.ini נכתב מחדש במלואו.
  const files = yemotFiles(settings);
  for (const dir of new Set(files.map(f => f.what.replace(/\/[^/]+$/, '')))) await yemotCall(token, 'UpdateExtension', { path: dir, type: dir === 'ivr2:' + extension ? 'menu' : 'playfile' }, fetchImpl);
  for (const f of files) await yemotCall(token, 'UploadTextFile', f, fetchImpl);
  return { ok: true, message: `שלוחה ${extension} מוגדרת. יחידות במערכת: ${s.units ?? '?'}` };
}

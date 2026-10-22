// פעולות ישירות מהמחשב, בלי לעבור דרך הסקריפט בגוגל (שכתובתו חסומה בנטפרי):
// שליחה לרוטינה ב-claude.ai, והגדרת השלוחה בימות המשיח. שני השירותים פתוחים בנטפרי.
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

/** בודק את טוקן ימות ומגדיר את השלוחה כשלוחת API שמפנה לסקריפט. */
export async function connectYemot({ token, extension, apiLink }, { fetchImpl = fetch } = {}) {
  if (!token) throw new Error('חסר טוקן של ימות');
  if (!extension) throw new Error('חסר מספר שלוחה');
  if (!apiLink) throw new Error('הסקריפט עוד לא פורסם');
  const s = await yemotCall(token, 'GetSession', {}, fetchImpl);
  await yemotCall(token, 'UpdateExtension', { path: 'ivr2:' + extension, type: 'api', api_link: apiLink }, fetchImpl);
  return { ok: true, message: `שלוחה ${extension} מחוברת. יחידות במערכת: ${s.units ?? '?'}` };
}

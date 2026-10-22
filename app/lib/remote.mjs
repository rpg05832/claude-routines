// תקשורת עם הסקריפט שבגוגל: POST עם JSON לכתובת ה-Web app. גוגל מחזיר את התשובה דרך הפניה, ו-fetch עוקב אחריה.

export class NeedsAuthError extends Error {
  constructor() { super('צריך לאשר לסקריפט הרשאות בגוגל (פעם אחת).'); this.code = 'NEEDS_AUTH'; }
}

export async function callRemote(execUrl, adminKey, op, args = {}, { fetchImpl = fetch, timeoutMs = 45_000 } = {}) {
  if (!execUrl) throw Object.assign(new Error('הסקריפט עוד לא פורסם'), { code: 'NOT_DEPLOYED' });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res, text;
  try {
    res = await fetchImpl(execUrl, {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: adminKey, op, args }),
    });
    text = await res.text();
  } catch (e) {
    throw Object.assign(new Error(e.name === 'AbortError' ? 'גוגל לא ענה בזמן' : 'אין חיבור לגוגל: ' + e.message), { code: 'NETWORK' });
  } finally { clearTimeout(t); }
  if (res.status === 418 || /netfree/i.test(text)) throw Object.assign(new Error('הכתובת של הסקריפט חסומה ברשת הזאת (נטפרי)'), { code: 'BLOCKED' });
  let j;
  try { j = JSON.parse(text); }
  catch {
    // דף HTML במקום JSON: בדרך כלל "Authorization is required" או דף התחברות של גוגל
    if (/authoriz|הרשא|accounts\.google|ServiceLogin|signin/i.test(text) || res.status === 401 || res.status === 403) throw new NeedsAuthError();
    throw Object.assign(new Error(`תשובה לא צפויה מגוגל (${res.status})`), { code: 'BAD_RESPONSE', detail: text.slice(0, 500) });
  }
  if (!j.ok) {
    if (j.error === 'NO_ACCESS') throw Object.assign(new Error('מפתח הניהול לא מתאים לסקריפט. צריך להעלות את הסקריפט מחדש (הגדרות, מתקדם).'), { code: 'NO_ACCESS' });
    throw Object.assign(new Error(j.error || 'שגיאה'), { code: 'REMOTE' });
  }
  return j.result;
}

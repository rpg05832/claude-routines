// ההגדרות (מקשים, תזמונים, חיבורים, ימות): ברירות מחדל, אימות, ויצירת Config.gs לסקריפט בגוגל.
import { randomBytes } from 'node:crypto';

export const FIRE_URL_RE = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/;

export function defaultSettings() {
  return {
    connections: [],   // {id, name, fireUrl, token}
    keys: [{ digit: '1', name: 'הדלקת קלוד', connectionId: 'main', text: 'בוקר טוב', confirm: 'ההודעה נשלחה לקלוד' }],
    schedules: [],     // {id, enabled, time:'HH:mm', days:[0..6], digit}
    yemot: { token: '', extension: '', key: '', allowedPhones: [], pin: '', greeting: 'שלום' },
  };
}

const rid = (n = 8) => randomBytes(n).toString('hex').slice(0, n);

export function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return d;
}

/** ממזג שינויים מהממשק לתוך ההגדרות הקיימות, עם אימות. שדה שלא נשלח נשאר. טוקן ריק משאיר את הקיים. */
export function applySettings(current, data) {
  const cfg = JSON.parse(JSON.stringify(current || defaultSettings()));
  if (data.connections) {
    const old = Object.fromEntries(cfg.connections.map(c => [c.id, c]));
    cfg.connections = data.connections.map(c => {
      const url = String(c.fireUrl || '').trim();
      if (url && !FIRE_URL_RE.test(url)) throw new Error(`הכתובת של "${c.name}" לא נראית ככתובת הפעלה של רוטינה (https://api.anthropic.com/v1/claude_code/routines/trig_.../fire)`);
      const id = String(c.id || rid());
      const token = String(c.token || '').trim() || old[id]?.token || '';
      return { id, name: String(c.name || 'חיבור').slice(0, 40), fireUrl: url, token };
    });
  }
  if (data.keys) {
    const seen = new Set();
    cfg.keys = data.keys.map(k => {
      const d = String(k.digit ?? '');
      if (!/^[0-9]$/.test(d)) throw new Error('מקש חייב להיות ספרה אחת');
      if (seen.has(d)) throw new Error(`המקש ${d} מופיע פעמיים`);
      seen.add(d);
      return { digit: d, name: String(k.name || '').slice(0, 40), connectionId: String(k.connectionId || ''), text: String(k.text || '').slice(0, 2000), confirm: String(k.confirm || '').slice(0, 120) };
    });
  }
  if (data.schedules) {
    const digits = new Set(cfg.keys.map(k => k.digit));
    cfg.schedules = data.schedules.map(s => {
      if (!/^\d{1,2}:\d{2}$/.test(s.time || '')) throw new Error('שעה לא תקינה: ' + s.time);
      const [h, m] = s.time.split(':').map(Number);
      if (h > 23 || m > 59) throw new Error('שעה לא תקינה: ' + s.time);
      if (!digits.has(String(s.digit))) throw new Error(`תזמון ${s.time} מפנה למקש שלא קיים`);
      const days = [...new Set((s.days || []).map(Number).filter(n => n >= 0 && n <= 6))].sort();
      if (!days.length) throw new Error(`לתזמון ${s.time} לא נבחר אף יום`);
      return { id: String(s.id || rid()), enabled: !!s.enabled, time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, days, digit: String(s.digit) };
    });
  }
  if (data.yemot) {
    const y = data.yemot;
    if (y.extension !== undefined) cfg.yemot.extension = String(y.extension || '').replace(/[^0-9/]/g, '').replace(/^\/+|\/+$/g, '');
    if (y.allowedPhones !== undefined) cfg.yemot.allowedPhones = String(Array.isArray(y.allowedPhones) ? y.allowedPhones.join(',') : y.allowedPhones || '').split(/[\s,;]+/).map(normPhone).filter(Boolean);
    if (y.greeting !== undefined) cfg.yemot.greeting = String(y.greeting || '').slice(0, 120);
    if (y.token) cfg.yemot.token = String(y.token).trim();
    if (y.clearToken) cfg.yemot.token = '';
    if (y.pin) {
      if (!/^\d{4,8}$/.test(y.pin)) throw new Error('קוד כניסה: 4 עד 8 ספרות');
      cfg.yemot.pin = y.pin;
    }
    if (y.clearPin) cfg.yemot.pin = '';
  }
  if (!/^[0-9a-f]{24}$/.test(cfg.yemot.key || '')) cfg.yemot.key = randomBytes(12).toString('hex');
  return cfg;
}

/** ההגדרות לממשק: בלי טוקנים, רק האם הם שמורים. */
export function publicSettings(cfg) {
  return {
    connections: cfg.connections.map(c => ({ id: c.id, name: c.name, fireUrl: c.fireUrl, hasToken: !!c.token })),
    keys: cfg.keys,
    schedules: cfg.schedules,
    yemot: { extension: cfg.yemot.extension, allowedPhones: cfg.yemot.allowedPhones.join(', '), hasPin: !!cfg.yemot.pin, greeting: cfg.yemot.greeting, hasToken: !!cfg.yemot.token },
  };
}

/** תוכן Config.gs: ההגדרות כ-JSON (כולל טוקנים: קוד המקור גלוי רק לבעל הסקריפט). */
export function configGs(cfg, savedAt = new Date().toISOString()) {
  const forScript = {
    savedAt,
    connections: cfg.connections,
    keys: cfg.keys,
    schedules: cfg.schedules,
    yemot: { key: cfg.yemot.key, allowedPhones: cfg.yemot.allowedPhones, pin: cfg.yemot.pin, greeting: cfg.yemot.greeting },
  };
  // JSON.stringify נותן JavaScript תקין. </ מוחלף כדי שלא יפריע לשום עורך HTML.
  return '// נוצר על ידי תוכנת "הדלקת קלוד". לא לערוך כאן: שינויים נעשים בתוכנה ונדרסים בשמירה הבאה.\n' +
    'var CONFIG = ' + JSON.stringify(forScript, null, 2).replace(/<\//g, '<\\/') + ';\n';
}

/* ---------- שעון ישראל ל-UTC (לתזמון של רוטינה ב-claude.ai, שתומך רק ב-UTC) ---------- */

/** ההפרש בדקות בין שעון ישראל ל-UTC בתאריך נתון (120 בחורף, 180 בקיץ). */
export function israelOffsetMinutes(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    .formatToParts(date).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/** ביטוי cron ב-UTC לשעה וימים בשעון ישראל, לפי ההפרש שבתוקף בתאריך הנתון. */
export function utcCron(time, days, date = new Date()) {
  const [h, m] = time.split(':').map(Number);
  let mins = h * 60 + m - israelOffsetMinutes(date);
  let shift = 0;
  if (mins < 0) { mins += 1440; shift = -1; }
  if (mins >= 1440) { mins -= 1440; shift = 1; }
  const d = [...new Set(days.map(x => (x + shift + 7) % 7))].sort((a, b) => a - b);
  return `${mins % 60} ${Math.floor(mins / 60)} * * ${d.length === 7 ? '*' : d.join(',')}`;
}

/** המעבר הבא בין שעון קיץ לחורף בישראל (או null), לאזהרה בממשק. */
export function nextDstChange(from = new Date()) {
  const start = israelOffsetMinutes(from);
  for (let d = 1; d <= 370; d++) {
    const t = new Date(from.getTime() + d * 86400000);
    if (israelOffsetMinutes(t) !== start) {
      for (let h = -24; h <= 0; h++) { const u = new Date(t.getTime() + h * 3600000); if (israelOffsetMinutes(u) !== start) return u; }
      return t;
    }
  }
  return null;
}

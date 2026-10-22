// הדמיה של שירותי גוגל להרצת Code.gs מחוץ לגוגל (בדיקות ושרת גוגל מדומה).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const SRC = readFileSync(new URL('../src/Code.gs', import.meta.url), 'utf8');
export const URL_OK = 'https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire';
export const KEY = 'k'.repeat(32);

export function makeEnv({ now = new Date('2026-10-25T04:12:00Z'), fireCode = 200, adminKey = KEY, execUrl = 'https://script.google.com/macros/s/ABC/exec', fetchHook, config } = {}) {
  const store = {}, cache = {}, triggers = [], fetches = [];
  const tzParts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d).map(p => [p.type, p.value]));
  const ctx = {
    console,
    Logger: { log() {} },
    ADMIN_KEY: adminKey,
    ...(config ? { CONFIG: config } : {}),
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); }, deleteProperty: k => { delete store[k]; } }) },
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
    },
    UrlFetchApp: {
      getRequest: (url) => ({ url }),
      fetch(url, o) {
        fetches.push({ url, o });
        if (fetchHook) { const h = fetchHook(url, o); if (h) return h; }
        if (url.includes('call2all')) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ responseStatus: 'OK', units: 50 }) };
        return { getResponseCode: () => fireCode, getContentText: () => JSON.stringify({ claude_code_session_url: 'https://claude.ai/code/session_1' }) };
      },
    },
    ContentService: { createTextOutput: s => ({ text: s, setMimeType() { return this; } }), MimeType: { TEXT: 'text', JSON: 'json' } },
    HtmlService: { createHtmlOutput: () => ({ setTitle() { return this; }, html: true }) },
    ScriptApp: {
      getService: () => ({ getUrl: () => execUrl }),
      getProjectTriggers: () => triggers,
      newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) }),
      deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
    },
    ...(now === null ? {} : { Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now.getTime(); } } }),
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const admin = (op, args, a = adminKey) => JSON.parse(ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify({ a, op, args }) } }).text);
  return { g: ctx, store, fetches, triggers, admin };
}


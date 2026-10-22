// מסלול claude.ai: ניהול רוטינות דרך Claude Code הרשמי שמותקן במחשב (כלי RemoteTrigger שלו).
// התוכנה לא פונה ל-claude.ai בעצמה: היא מריצה את Claude Code במצב מבודד (בלי התוספים, החיבורים וההגדרות
// של המשתמש, רק עם כלי הרוטינות ועם Haiku), כדי שכל פעולה תעלה מעט ותהיה צפויה.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from './paths.mjs';
import { log } from './store.mjs';
import { utcCron, israelOffsetMinutes } from './settings.mjs';

const CWD = join(DATA_DIR, 'claude-cwd');
export const ROUTINE_PROMPT_SUFFIX = '\n\n(הודעה קבועה מ"הדלקת קלוד". ענה בקצרה, במשפט אחד בעברית. אל תשתמש בשום כלי ואל תבצע פעולות.)';

/* ---------- איתור והפעלה ---------- */

/** מאתר את Claude Code: PATH, ההתקנה הרשמית (~/.local/bin), npm. מחזיר נתיב או null. */
export function findClaude() {
  if (process.env.CLAUDE_WAKE_CLAUDE) return process.env.CLAUDE_WAKE_CLAUDE;
  const home = process.env.USERPROFILE || '';
  const known = [join(home, '.local', 'bin', 'claude.exe'), join(process.env.APPDATA || '', 'npm', 'claude.cmd')];
  // חיפוש ב-PATH מתוך Node: where.exe מחזיר נתיב עם עברית משובש (קידוד OEM)
  const dirs = String(process.env.PATH || process.env.Path || '').split(';').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  for (const ext of ['.exe', '.cmd']) {
    for (const d of dirs) { const f = join(d, 'claude' + ext); if (existsSync(f)) return f; }
  }
  return known.find(existsSync) || null;
}

/** מריץ את Claude Code. קובץ .cmd (התקנת npm) רץ דרך cmd.exe. */
export function runClaude(exe, args, { timeoutMs = 180_000, cwd = CWD } = {}) {
  mkdirSync(cwd, { recursive: true });
  // התקנת npm: מריצים את cli.js ישירות עם Node, בלי עטיפת ה-cmd (שמשבשת ארגומנטים עם JSON ועברית)
  const cli = /\.cmd$/i.test(exe) ? join(exe, '..', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js') : '';
  if (cli && existsSync(cli)) exe = cli;
  const isCmd = /\.(cmd|bat)$/i.test(exe);
  const isMjs = /\.m?js$/i.test(exe);   // cli.js של npm, או Claude Code מדומה בבדיקות
  const cmd = isCmd ? 'cmd.exe' : isMjs ? process.execPath : exe;
  const argv = isCmd ? ['/d', '/s', '/c', `"${exe}" ${args.map(q).join(' ')}`] : isMjs ? [exe, ...args] : args;
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, {
      cwd, windowsHide: true, windowsVerbatimArguments: isCmd,
      // תעודת נטפרי: Claude Code של npm רץ על Node, ובלי זה נכשל ב-"SSL certificate verification failed"
      env: { ...process.env, NODE_OPTIONS: '--use-system-ca', NODE_USE_SYSTEM_CA: '1' },
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.stdin.end();
    const t = setTimeout(() => { child.kill(); out += '\n(חרג מהזמן)'; }, timeoutMs);
    child.on('close', code => { clearTimeout(t); resolve({ code, out }); });
    child.on('error', e => { clearTimeout(t); resolve({ code: -1, out: e.message }); });
  });
}

/** ציטוט ארגומנט לשורת cmd.exe. */
function q(a) {
  const s = String(a);
  if (/^[\w\-.,:=/\\]+$/.test(s)) return s;
  return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1').replace(/%/g, '%%') + '"';
}

/** מצב Claude Code במחשב. */
export async function detect() {
  const exe = findClaude();
  if (!exe) return { installed: false };
  const v = await runClaude(exe, ['--version'], { timeoutMs: 30_000 });
  const version = (/(\d+\.\d+\.\d+)/.exec(v.out) || [])[1] || '';
  const a = await runClaude(exe, ['auth', 'status', '--json'], { timeoutMs: 30_000 });
  let auth = {};
  try { auth = JSON.parse(a.out.slice(a.out.indexOf('{'), a.out.lastIndexOf('}') + 1)); } catch { /* לא מחובר או גרסה ישנה */ }
  return { installed: true, path: exe, version, loggedIn: !!auth.loggedIn && auth.authMethod === 'claude.ai', email: auth.email || '', subscription: auth.subscriptionType || '' };
}

/** התקנה או עדכון של Claude Code בהתקנה הרשמית של Anthropic (בלי הרשאות מנהל). */
export async function install() {
  const r = await new Promise((resolve) => {
    const c = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'], { windowsHide: true });
    let out = '';
    c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
    const t = setTimeout(() => { c.kill(); out += '\n(חרג מהזמן)'; }, 600_000);
    c.on('close', code => { clearTimeout(t); resolve({ code, out }); });
  });
  log('claude-install', r.code, r.out.slice(-1500));
  const d = await detect();
  if (!d.installed) throw Object.assign(new Error('ההתקנה של Claude Code לא הצליחה. אם יש נטפרי, ודא שהאתר claude.ai פתוח.'), { detail: r.out });
  return d;
}

/** פותח חלון שבו המשתמש מתחבר ל-Claude (claude auth login). התוכנה בודקת אחר כך עם detect. */
export function openLogin() {
  const exe = findClaude();
  if (!exe) throw new Error('Claude Code לא מותקן');
  spawn('cmd.exe', ['/c', 'start', '"התחברות ל-Claude"', 'cmd', '/k', `"${exe}" auth login`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, env: { ...process.env, NODE_OPTIONS: '--use-system-ca' } }).unref();
}

/* ---------- רוטינות דרך RemoteTrigger ---------- */

/**
 * מריץ כמה פעולות של RemoteTrigger בקריאה אחת ל-Claude Code, ומחזיר את התשובות הגולמיות לפי הסדר:
 * [{status, json}]. תשובה גדולה ש-Claude Code שמר לקובץ נקראת מהקובץ.
 */
export async function remoteTriggerBatch(calls, { exe = findClaude() } = {}) {
  if (!exe) throw Object.assign(new Error('Claude Code לא מותקן'), { code: 'NO_CLAUDE' });
  const prompt = (calls.length === 1 ? 'Use the RemoteTrigger tool once' : `Use the RemoteTrigger tool ${calls.length} times, one call after another, in this order`) +
    ', passing exactly the input shown. Do not change, merge, or skip any input.\n' +
    calls.map((c, i) => `${i + 1}. ${JSON.stringify(c)}`).join('\n') + '\nWhen all calls are done, reply DONE.';
  const system = 'You are an automation step. You must invoke the RemoteTrigger tool through real tool calls. Never write a tool call as text or XML.';
  const args = ['-p', prompt, '--model', 'haiku', '--append-system-prompt', system, '--setting-sources', 'project', '--strict-mcp-config',
    '--disable-slash-commands', '--tools', 'RemoteTrigger', '--allowedTools', 'RemoteTrigger', '--output-format', 'stream-json', '--verbose',
    '--no-session-persistence', '--max-turns', String(calls.length + 2)];
  let r = await runClaude(exe, args);
  let results = parseToolResults(r.out);
  if (results.length < calls.length && results.length === 0 && !/SSL|certificate|login|401/i.test(r.out)) {
    log('claude', 'אין קריאה לכלי, ניסיון חוזר');
    r = await runClaude(exe, args);
    results = parseToolResults(r.out);
  }
  if (results.length < calls.length) {
    const err = /"result":"([^"]{0,300})/.exec(r.out);
    const msg = err ? err[1] : r.out.trim().split(/\r?\n/).slice(-1)[0];
    if (/SSL|certificate/i.test(msg)) throw Object.assign(new Error('Claude Code לא מצליח להתחבר (תעודת אבטחה). אם יש נטפרי, ודא שתעודת נטפרי מותקנת ב-Windows.'), { detail: r.out });
    if (/login|log in|auth|401/i.test(msg)) throw Object.assign(new Error('Claude Code לא מחובר. צריך להתחבר ל-Claude.'), { code: 'NOT_LOGGED_IN', detail: r.out });
    throw Object.assign(new Error('Claude Code לא השלים את הפעולה: ' + String(msg).slice(0, 200)), { detail: r.out.slice(-3000) });
  }
  return results;
}

/** מוציא את תשובות הכלי מפלט stream-json של Claude Code. */
export function parseToolResults(out) {
  const res = [];
  for (const line of String(out).split(/\r?\n/)) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'user' || !j.message?.content) continue;
    for (const c of j.message.content) {
      if (c.type !== 'tool_result') continue;
      let text = typeof c.content === 'string' ? c.content : (c.content || []).map(x => x.text || '').join('');
      const saved = /Full output saved to:\s*(.+?\.txt)/.exec(text);
      if (saved && existsSync(saved[1].trim())) text = readFileSync(saved[1].trim(), 'utf8');
      res.push(parseHttp(text));
    }
  }
  return res;
}

function parseHttp(text) {
  const status = Number((/HTTP (\d{3})/.exec(text) || [])[1] || 0);
  let json = null;
  const a = text.indexOf('{');
  if (a >= 0) {
    for (let b = text.lastIndexOf('}'); b > a; b = text.lastIndexOf('}', b - 1)) {
      try { json = JSON.parse(text.slice(a, b + 1)); break; } catch { /* מקצרים */ }
    }
  }
  return { status, json, text: json ? '' : text.slice(0, 500) };
}

const ok = (r, what) => {
  if (r.status >= 200 && r.status < 300 && r.json) return r.json;
  const m = r.json?.error?.message || r.text || 'HTTP ' + r.status;
  throw new Error(`${what}: ${m}`);
};

/** מזהה הסביבה בענן, מתוך רוטינה קיימת (אין דרך אחרת לקבל אותו). */
export function envIdFrom(listJson) {
  for (const t of listJson?.data || []) {
    const e = t.session_request?.environment_id || t.job_config?.ccr?.environment_id;
    if (e) return e;
  }
  return '';
}

export async function listRoutines() {
  const [r] = await remoteTriggerBatch([{ action: 'list' }]);
  return ok(r, 'רשימת הרוטינות');
}

function routineBody({ name, prompt, cron, enabled, envId }) {
  return {
    name, enabled, cron_expression: cron,
    mcp_connections: [], clear_mcp_connections: true,   // בלי חיבורים (Gmail, Drive...): הודעת השכמה לא צריכה אותם
    job_config: { ccr: {
      environment_id: envId,
      session_context: { model: 'claude-haiku-5-5', sources: [], allowed_tools: [] },
      events: [{ data: { uuid: randomUUID(), session_id: '', type: 'user', parent_tool_use_id: null, message: { role: 'user', content: prompt } } }],
    } },
  };
}

/**
 * מסנכרן את התזמונים עם רוטינות ב-claude.ai: רוטינה לכל תזמון, עם cron ב-UTC לפי שעון ישראל של היום.
 * תזמון שהוסר או כובה: הרוטינה שלו מושבתת (אי אפשר למחוק דרך הכלי). מחזיר את המיפוי החדש.
 */
export async function syncSchedules({ settings, state, now = new Date() }) {
  if (!state.envId) throw new Error('חסר מזהה סביבה. צריך ליצור רוטינה אחת באתר claude.ai קודם.');
  const map = { ...(state.routines || {}) };
  const calls = [], plan = [];
  for (const s of settings.schedules) {
    const key = settings.keys.find(k => k.digit === s.digit);
    const body = routineBody({
      name: `הדלקת קלוד ${s.time} (${key?.name || 'מקש ' + s.digit})`.slice(0, 80),
      prompt: (key?.text || 'בוקר טוב') + ROUTINE_PROMPT_SUFFIX,
      cron: utcCron(s.time, s.days, now), enabled: !!s.enabled, envId: state.envId,
    });
    if (map[s.id]) calls.push({ action: 'update', trigger_id: map[s.id], body });
    else calls.push({ action: 'create', body });
    plan.push(s.id);
  }
  const keep = new Set(settings.schedules.map(s => s.id));
  for (const [sid, tid] of Object.entries(map)) {
    if (!keep.has(sid)) { calls.push({ action: 'update', trigger_id: tid, body: { enabled: false } }); plan.push('-' + sid); }
  }
  if (!calls.length) return { routines: map, offset: israelOffsetMinutes(now) };
  const results = await remoteTriggerBatch(calls);
  results.forEach((r, i) => {
    const sid = plan[i];
    const j = ok(r, 'עדכון רוטינה');
    if (sid.startsWith('-')) delete map[sid.slice(1)];
    else map[sid] = j.trigger?.id || j.id || map[sid];
  });
  return { routines: map, offset: israelOffsetMinutes(now) };
}

/** "שלח עכשיו": מפעיל את הרוטינה של התזמון הראשון של המקש, או יוצר רוטינה כבויה למקש ומפעיל אותה. */
export async function runKeyNow({ settings, state, digit }) {
  const key = settings.keys.find(k => k.digit === String(digit));
  if (!key) throw new Error('אין מקש ' + digit);
  const sched = settings.schedules.find(s => s.digit === key.digit && state.routines?.[s.id]);
  let tid = sched ? state.routines[sched.id] : state.manual?.[key.digit];
  let created = null;
  if (!tid) {
    const [c] = await remoteTriggerBatch([{ action: 'create', body: routineBody({ name: `הדלקת קלוד ידנית (${key.name || key.digit})`, prompt: key.text + ROUTINE_PROMPT_SUFFIX, cron: '0 0 1 1 *', enabled: false, envId: state.envId }) }]);
    tid = ok(c, 'יצירת רוטינה').trigger?.id;
    created = { [key.digit]: tid };
  }
  const [r] = await remoteTriggerBatch([{ action: 'run', trigger_id: tid }]);
  ok(r, 'הפעלת הרוטינה');
  return { ok: true, message: 'נשלח', manual: created };
}

/** ריצות אחרונות של הרוטינות (ליומן), בקריאה אחת. */
export async function recentRuns(triggerIds) {
  if (!triggerIds.length) return [];
  const results = await remoteTriggerBatch(triggerIds.map(id => ({ action: 'list_runs', trigger_id: id })));
  const runs = [];
  results.forEach((r) => { for (const x of r.json?.data || []) runs.push({ at: x.created_at, title: x.title, status: x.status, url: x.url }); });
  return runs.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30);
}

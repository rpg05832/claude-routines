// הפעולות שהממשק קורא להן (/api/...), לשלושת המסלולים: google, claude, github.
import { loadLocal, saveLocal, ensureAdminKey, addLocalLog, log } from './store.mjs';
import { applySettings, publicSettings, israelOffsetMinutes, nextDstChange } from './settings.mjs';
import * as google from './google.mjs';
import * as cc from './claudecode.mjs';
import { GitHub, syncRepo } from './github.mjs';
import { fire, connectYemot } from './direct.mjs';
import { callRemote } from './remote.mjs';

export const LINKS = {
  apiSettings: () => google.API_SETTINGS_URL,
  routines: () => 'https://claude.ai/code/routines',
  usage: () => 'https://claude.ai/settings/usage',
  editor: (l) => l.google.scriptId && google.editorUrl(l.google.scriptId),
  execPage: (l) => l.google.execUrl,
  ghTokens: () => 'https://github.com/settings/personal-access-tokens/new',
  ghRepo: (l) => l.github.repo && `https://github.com/${l.github.repo}`,
  ghActions: (l) => l.github.repo && `https://github.com/${l.github.repo}/actions`,
};

export function makeRoutes({ appVersion, openUrl }) {
  let busy = '';
  const guard = async (what, fn) => {
    if (busy) throw new Error(`פעולה אחרת עוד רצה (${busy}). חכה שתסתיים.`);
    busy = what;
    try { return await fn(); } finally { busy = ''; }
  };
  const apiLinkOf = (l) => l.google.execUrl ? `${l.google.execUrl}?k=${l.settings.yemot.key}` : '';

  function status() {
    const l = loadLocal();
    const now = new Date();
    const dst = nextDstChange(now);
    return {
      appVersion, busy,
      mode: l.mode, wizardDone: l.wizardDone,
      settings: publicSettings(l.settings),
      google: {
        deployed: !!l.google.execUrl, email: l.google.email, authorized: l.google.authorized,
        deployedVersion: l.google.deployedVersion, bundledVersion: google.scriptVersionOf(),
        configSavedAt: l.google.configSavedAt, yemotApiLink: apiLinkOf(l) ? 'מוגדרת' : '',
      },
      claude: {
        envId: !!l.claude.envId, routines: Object.keys(l.claude.routines).length, lastSync: l.claude.lastSync,
        offsetStale: l.mode === 'claude' && Object.keys(l.claude.routines).length > 0 && l.claude.offset !== israelOffsetMinutes(now),
        nextDst: dst ? dst.toISOString() : '',
      },
      github: { connected: !!(l.github.token && l.github.repo), repo: l.github.repo, isPrivate: l.github.isPrivate },
      localLog: l.localLog,
    };
  }

  /** מחיל הגדרות בענן לפי המסלול. מחזיר הודעה. */
  async function pushSettings(l) {
    if (l.mode === 'google') {
      if (!l.google.scriptId) return 'נשמר במחשב. יעלה לגוגל בשלב "ענן".';
      const r = await google.deploy({ local: l.google, adminKey: ensureAdminKey(), settings: l.settings });
      saveLocal({ google: { ...r, configSavedAt: new Date().toISOString() } });
      return 'נשמר והועלה לגוגל';
    }
    if (l.mode === 'claude') {
      if (!l.claude.envId) return 'נשמר במחשב. יסונכרן עם claude.ai אחרי החיבור.';
      const r = await cc.syncSchedules({ settings: l.settings, state: l.claude });
      saveLocal({ claude: { routines: r.routines, offset: r.offset, lastSync: new Date().toISOString() } });
      return 'נשמר וסונכרן עם claude.ai';
    }
    if (l.mode === 'github') {
      if (!l.github.token || !l.github.repo) return 'נשמר במחשב. יעלה ל-GitHub אחרי החיבור.';
      const gh = new GitHub(l.github.token);
      const sent = await syncRepo(gh, { repo: l.github.repo, isPrivate: l.github.isPrivate, settings: l.settings, tokensSent: l.github.tokensSent, branch: l.github.branch });
      saveLocal({ github: { tokensSent: sent } });
      return 'נשמר והועלה ל-GitHub';
    }
    return 'נשמר';
  }

  return {
    ping: async () => ({ ok: true }),
    heartbeat: async () => ({ ok: true }),
    status: async () => status(),

    'mode/set': async (b) => {
      if (!['google', 'claude', 'github'].includes(b.mode)) throw new Error('מסלול לא מוכר');
      saveLocal({ mode: b.mode });
      return status();
    },
    'wizard/done': async () => { saveLocal({ wizardDone: true }); return status(); },
    'wizard/reset': async () => { saveLocal({ wizardDone: false }); return status(); },

    /** שמירת הגדרות (מקשים, תזמונים, חיבורים, ימות) והחלה בענן לפי המסלול. */
    'settings/save': async (b) => guard('שמירה', async () => {
      const l = loadLocal();
      const before = JSON.stringify({ e: l.settings.yemot.extension, k: l.settings.yemot.key, t: l.settings.yemot.token });
      const settings = applySettings(l.settings, b.data || {});
      const saved = saveLocal({ settings });
      let message = await pushSettings(saved);
      // אם השלוחה, המפתח או הטוקן של ימות השתנו: מחברים אותה מחדש, ישירות מול ימות
      const after = JSON.stringify({ e: settings.yemot.extension, k: settings.yemot.key, t: settings.yemot.token });
      if (saved.mode === 'google' && settings.yemot.token && settings.yemot.extension && saved.google.execUrl && (before !== after || b.reconnectYemot)) {
        const r = await connectYemot({ token: settings.yemot.token, extension: settings.yemot.extension, apiLink: apiLinkOf(loadLocal()) });
        message += '. ' + r.message;
        addLocalLog('ימות', r.message, true);
      }
      return { message, status: status() };
    }),

    /** "שלח עכשיו". */
    fire: async (b) => guard('שליחה', async () => {
      const l = loadLocal();
      const key = l.settings.keys.find(k => k.digit === String(b.digit));
      if (!key) throw new Error('אין מקש ' + b.digit);
      let r;
      if (l.mode === 'claude') {
        r = await cc.runKeyNow({ settings: l.settings, state: l.claude, digit: key.digit });
        if (r.manual) saveLocal({ claude: { manual: { ...l.claude.manual, ...r.manual } } });
      } else {
        const conn = l.settings.connections.find(c => c.id === key.connectionId) || l.settings.connections[0];
        r = conn ? await fire(conn.fireUrl, conn.token, key.text) : { ok: false, message: 'אין חיבור לקלוד' };
      }
      addLocalLog(b.source || 'כפתור', `${key.name || 'מקש ' + key.digit} (${key.digit}): ${r.message}`, r.ok);
      return r;
    }),

    /** היומן: בגוגל מהסקריפט (אם הכתובת לא חסומה), ב-GitHub מהריצות, ב-claude.ai מהרוטינות (עולה מעט שימוש). */
    'log/cloud': async () => {
      const l = loadLocal();
      if (l.mode === 'google') {
        try { return { kind: 'google', items: await callRemote(l.google.execUrl, l.google.adminKey, 'log') }; }
        catch (e) { return { kind: 'google', unavailable: e.code === 'BLOCKED' ? 'הכתובת של הסקריפט חסומה כאן (למשל בנטפרי), ולכן היומן מהענן לא זמין. השליחות עצמן עובדות.' : e.message }; }
      }
      if (l.mode === 'github') return { kind: 'github', items: await new GitHub(l.github.token).runs(l.github.repo) };
      if (l.mode === 'claude') return { kind: 'claude', items: await guard('יומן', () => cc.recentRuns([...Object.values(l.claude.routines), ...Object.values(l.claude.manual)])) };
      return { kind: '', items: [] };
    },
    'log/clear': async () => { saveLocal({ localLog: [] }); return status(); },

    open: async (b) => {
      const f = LINKS[b.what];
      const url = f && f(loadLocal());
      if (!url) throw new Error('אין מה לפתוח');
      openUrl(url);
      return { ok: true };
    },

    /* ----- גוגל ----- */
    'google/whoami': async () => { const email = await google.whoAmI(); saveLocal({ google: { email: email || '' } }); return { email }; },
    'google/login': async () => { const email = await google.login(); saveLocal({ google: { email: email || '' } }); return { email }; },
    'google/logout': async () => { await google.logout(); saveLocal({ google: { email: '' } }); return { ok: true }; },
    'google/check-api': async () => google.checkApi(),
    'google/deploy': async () => guard('העלאה לגוגל', async () => {
      const l = loadLocal();
      const settings = applySettings(l.settings, {});   // מוודא מפתח שלוחה
      saveLocal({ settings });
      const steps = [];
      const r = await google.deploy({ local: l.google, adminKey: ensureAdminKey(), settings, onStep: s => { steps.push(s); log('deploy', s); } });
      saveLocal({ google: { ...r, configSavedAt: new Date().toISOString() } });
      return { steps, status: status() };
    }),
    /** בודק אם הסקריפט עונה (רק כשהכתובת לא חסומה). */
    'google/ping': async () => {
      const l = loadLocal();
      try { const r = await callRemote(l.google.execUrl, l.google.adminKey, 'ping'); return { reachable: true, ticker: r.ticker }; }
      catch (e) { return { reachable: false, needsAuth: e.code === 'NEEDS_AUTH', blocked: e.code === 'BLOCKED', message: e.message }; }
    },
    'google/authorized': async () => { saveLocal({ google: { authorized: true } }); return status(); },

    /* ----- Claude Code (מסלול claude.ai) ----- */
    'claude/detect': async () => cc.detect(),
    'claude/install': async () => guard('התקנת Claude Code', () => cc.install()),
    'claude/login': async () => { cc.openLogin(); return { ok: true }; },
    'claude/env': async () => guard('חיפוש סביבה', async () => {
      const list = await cc.listRoutines();
      const envId = cc.envIdFrom(list);
      if (!envId) throw Object.assign(new Error('עוד אין אף רוטינה בחשבון, ולכן לא ידוע מזהה הסביבה. צור רוטינה אחת ב-claude.ai (כל רוטינה), ונסה שוב.'), { code: 'NO_ENV' });
      saveLocal({ claude: { envId } });
      return { ok: true, routines: list.data?.length || 0 };
    }),
    'claude/resync': async () => guard('סנכרון', async () => ({ message: await pushSettings(loadLocal()), status: status() })),

    /* ----- GitHub ----- */
    'github/connect': async (b) => guard('חיבור ל-GitHub', async () => {
      const l = loadLocal();
      const token = String(b.token || '').trim() || l.github.token;
      if (!token) throw new Error('חסר טוקן של GitHub');
      const name = String(b.repo || 'claude-wake').trim().replace(/^.*\//, '');
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw new Error('שם ריפו: אותיות באנגלית, ספרות, נקודה, מקף וקו תחתון');
      const gh = new GitHub(token);
      const me = await gh.user();
      const repo = await gh.ensureRepo(me.login, name, !!b.isPrivate);
      saveLocal({ github: { token, owner: me.login, repo: repo.full_name, isPrivate: !!repo.private, branch: repo.default_branch || 'main', tokensSent: l.github.repo === repo.full_name ? l.github.tokensSent : {} } });
      const message = await pushSettings(loadLocal());
      return { message, repo: repo.full_name, status: status() };
    }),
  };
}

/** בפתיחת התוכנה במסלול claude.ai: אם השעון עבר בין קיץ לחורף, מעדכנים את שעות הרוטינות. */
export async function dstCatchUp() {
  const l = loadLocal();
  if (l.mode !== 'claude' || !l.claude.envId || !Object.keys(l.claude.routines).length) return;
  if (l.claude.offset === israelOffsetMinutes()) return;
  try {
    const r = await cc.syncSchedules({ settings: l.settings, state: l.claude });
    saveLocal({ claude: { routines: r.routines, offset: r.offset, lastSync: new Date().toISOString() } });
    addLocalLog('שעון', 'השעון התחלף: שעות הרוטינות עודכנו', true);
  } catch (e) {
    addLocalLog('שעון', 'עדכון השעות אחרי החלפת השעון נכשל: ' + e.message, false);
  }
}

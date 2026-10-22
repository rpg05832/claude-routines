// מסלול GitHub: הדלקה לפי תזמון ב-GitHub Actions. התוכנה מנהלת ריפו של המשתמש דרך ה-API של GitHub:
// קבצים (workflow, wake.json, wake.py), Secrets מוצפנים, הפעלה ידנית ויומן ריצות.
import nacl from 'tweetnacl';
import blake from 'blakejs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR } from './paths.mjs';

const API = process.env.CLAUDE_WAKE_GITHUB_API || 'https://api.github.com';   // משתנה רק בבדיקות
export const WORKFLOW = 'claude-wake.yml';

export class GitHub {
  constructor(token, { fetchImpl = fetch } = {}) { this.token = token; this.fetch = fetchImpl; }

  async req(method, path, body) {
    let r;
    try {
      r = await this.fetch(API + path, {
        method, signal: AbortSignal.timeout(30_000),
        headers: { authorization: 'Bearer ' + this.token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new Error('אין חיבור ל-GitHub: ' + e.message); }
    const text = await r.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* */ }
    if (r.status === 404) return { status: 404, json: j };
    if (r.status === 401) throw Object.assign(new Error('הטוקן של GitHub לא תקין או פג תוקף'), { code: 'GH_AUTH' });
    if (r.status === 403) throw Object.assign(new Error(`לטוקן של GitHub חסרה הרשאה (${j?.message || '403'}). ראה את רשימת ההרשאות הנדרשות.`), { code: 'GH_PERM' });
    if (r.status >= 400) throw new Error(`GitHub ${r.status}: ${j?.message || text.slice(0, 200)}`);
    return { status: r.status, json: j };
  }

  async user() { return (await this.req('GET', '/user')).json; }

  /** הריפו קיים? אם לא: נוצר (צריך הרשאת Administration). */
  async ensureRepo(owner, name, isPrivate) {
    const g = await this.req('GET', `/repos/${owner}/${name}`);
    if (g.status !== 404) return g.json;
    const c = await this.req('POST', '/user/repos', { name, private: !!isPrivate, auto_init: true, description: 'הדלקת קלוד: תזמונים ב-GitHub Actions' });
    return c.json;
  }

  async putFile(repo, path, content, message) {
    const cur = await this.req('GET', `/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`);
    const b64 = Buffer.from(content, 'utf8').toString('base64');
    if (cur.status !== 404 && cur.json?.content && cur.json.content.replace(/\n/g, '') === b64) return false;   // לא השתנה
    await this.req('PUT', `/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, { message, content: b64, ...(cur.status !== 404 ? { sha: cur.json.sha } : {}) });
    return true;
  }

  async setSecret(repo, name, value) {
    const k = (await this.req('GET', `/repos/${repo}/actions/secrets/public-key`)).json;
    await this.req('PUT', `/repos/${repo}/actions/secrets/${name}`, { encrypted_value: sealedBox(value, k.key), key_id: k.key_id });
  }

  async dispatch(repo, digit, ref = 'main') {
    await this.req('POST', `/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, { ref, inputs: { key: String(digit) } });
  }

  async runs(repo) {
    const r = await this.req('GET', `/repos/${repo}/actions/workflows/${WORKFLOW}/runs?per_page=15`);
    return (r.json?.workflow_runs || []).map(x => ({ at: x.created_at, event: x.event, status: x.status, conclusion: x.conclusion, url: x.html_url }));
  }
}

/** הצפנת Secret כמו ש-GitHub דורש (libsodium sealed box): X25519 + XSalsa20-Poly1305, nonce = blake2b(epk||pk, 24). */
export function sealedBox(message, publicKeyB64) {
  const pk = Buffer.from(publicKeyB64, 'base64');
  const eph = nacl.box.keyPair();
  const nonce = blake.blake2b(Buffer.concat([Buffer.from(eph.publicKey), pk]), undefined, 24);
  const box = nacl.box(Buffer.from(message, 'utf8'), nonce, pk, eph.secretKey);
  return Buffer.concat([Buffer.from(eph.publicKey), Buffer.from(box)]).toString('base64');
}

/** פתיחת sealed box (לבדיקות בלבד). */
export function openSealedBox(b64, publicKey, secretKey) {
  const all = Buffer.from(b64, 'base64');
  const epk = all.subarray(0, 32), box = all.subarray(32);
  const nonce = blake.blake2b(Buffer.concat([epk, Buffer.from(publicKey)]), undefined, 24);
  const m = nacl.box.open(box, nonce, epk, secretKey);
  return m ? Buffer.from(m).toString('utf8') : null;
}

/** שם הסוד לחיבור: main הוא ברירת המחדל (בלי סיומת). */
export function secretSuffix(connectionId) {
  if (!connectionId || connectionId === 'main') return '';
  return '_' + String(connectionId).toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/** wake.json לפי ההגדרות. */
export function wakeJson(settings, isPrivate) {
  return JSON.stringify({
    windowMinutes: isPrivate ? 35 : 20,
    keys: settings.keys.map(k => ({ digit: k.digit, name: k.name, text: k.text, connection: secretSuffix(k.connectionId).slice(1).toLowerCase() })),
    schedules: settings.schedules.map(s => ({ enabled: s.enabled, time: s.time, days: s.days, digit: s.digit })),
  }, null, 2) + '\n';
}

/** קובץ ה-workflow: cron לפי סוג הריפו, ושורת env לכל חיבור. */
export function workflowYml(settings, isPrivate) {
  const conns = [...new Set(['main', ...settings.connections.map(c => c.id)])];
  const env = conns.flatMap(id => {
    const s = secretSuffix(id);
    return [`          CLAUDE_FIRE_URL${s}: \${{ secrets.CLAUDE_FIRE_URL${s} }}`, `          CLAUDE_FIRE_TOKEN${s}: \${{ secrets.CLAUDE_FIRE_TOKEN${s} }}`];
  }).join('\n');
  return `# נוצר על ידי תוכנת "הדלקת קלוד". שינויים נעשים בתוכנה.
name: הדלקת קלוד

on:
  schedule:
    - cron: '${isPrivate ? '*/30 * * * *' : '*/10 * * * *'}'
  workflow_dispatch:
    inputs:
      key:
        description: 'מקש לשליחה'
        required: true
        default: '1'

permissions:
  contents: read

concurrency:
  group: claude-wake
  cancel-in-progress: false

jobs:
  wake:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - uses: actions/checkout@v4
      - uses: actions/cache/restore@v4
        with:
          path: .wake-state.json
          key: wake-state-\${{ github.run_id }}
          restore-keys: wake-state-
      - name: שליחה לקלוד
        env:
${env}
          KEY: \${{ github.event.inputs.key }}
        run: |
          if [ -n "$KEY" ]; then python3 wake.py --key "$KEY"; else python3 wake.py; fi
      - uses: actions/cache/save@v4
        if: always()
        with:
          path: .wake-state.json
          key: wake-state-\${{ github.run_id }}
`;
}

/** wake.py מצורף לתוכנה (התיקייה github בהתקנה, או github/ בפיתוח). */
export function wakePy() {
  for (const p of [join(APP_DIR, 'github', 'wake.py'), join(APP_DIR, '..', 'github', 'wake.py')]) {
    try { return readFileSync(p, 'utf8'); } catch { /* הבא */ }
  }
  throw new Error('wake.py לא נמצא בתוכנה');
}

/**
 * מעלה לריפו את הקבצים ואת ה-Secrets שהשתנו. tokensSent: טביעות של טוקנים שכבר הועלו, כדי לא להעלות שוב.
 * מחזיר את הטביעות המעודכנות.
 */
export async function syncRepo(gh, { repo, isPrivate, settings, tokensSent = {}, branch = 'main' }) {
  await gh.putFile(repo, '.github/workflows/' + WORKFLOW, workflowYml(settings, isPrivate), 'הדלקת קלוד: workflow');
  await gh.putFile(repo, 'wake.py', wakePy(), 'הדלקת קלוד: wake.py');
  await gh.putFile(repo, 'wake.json', wakeJson(settings, isPrivate), 'הדלקת קלוד: הגדרות');
  const sent = { ...tokensSent };
  for (const c of settings.connections) {
    if (!c.token || !c.fireUrl) continue;
    const fp = fingerprint(c.fireUrl + '|' + c.token);
    if (sent[c.id] === fp) continue;
    const s = secretSuffix(c.id);
    await gh.setSecret(repo, 'CLAUDE_FIRE_URL' + s, c.fireUrl);
    await gh.setSecret(repo, 'CLAUDE_FIRE_TOKEN' + s, c.token);
    sent[c.id] = fp;
  }
  return sent;
}

function fingerprint(s) {
  return Buffer.from(blake.blake2b(Buffer.from(s, 'utf8'), undefined, 16)).toString('hex');
}

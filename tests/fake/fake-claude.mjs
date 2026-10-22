// Claude Code מדומה: --version, auth status, ומצב -p שמבצע את קריאות RemoteTrigger מהפרומפט על רוטינות שבקובץ.
// FAKE_CLAUDE_STATE: קובץ המצב. FAKE_CLAUDE_NOENV=1: אין עדיין רוטינות בחשבון.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FILE = process.env.FAKE_CLAUDE_STATE;
const st = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { loggedIn: true, routines: process.env.FAKE_CLAUDE_NOENV ? [] : [{ id: 'trig_existing', name: 'קיימת', session_request: { environment_id: 'env_fake' } }], runs: [], n: 0 };
const save = () => writeFileSync(FILE, JSON.stringify(st, null, 2));
const args = process.argv.slice(2);

if (args[0] === '--version') { console.log('2.1.300 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: st.loggedIn, authMethod: 'claude.ai', email: 'ab1234@gmail.com', subscriptionType: 'max' })); process.exit(st.loggedIn ? 0 : 1); }
if (args[0] !== '-p') { console.log('unknown'); process.exit(1); }

const prompt = args[1];
const calls = prompt.split('\n').map(l => /^\d+\. (\{.*\})$/.exec(l)).filter(Boolean).map(m => JSON.parse(m[1]));
const out = (o) => console.log(JSON.stringify(o));
out({ type: 'system', subtype: 'init', tools: ['RemoteTrigger'] });
for (const c of calls) {
  let r;
  if (c.action === 'list') r = { data: st.routines };
  else if (c.action === 'create') { const id = 'trig_fake' + (++st.n); st.routines.push({ id, ...c.body }); r = { outcome: 'CREATE_TRIGGER_OUTCOME_CREATED', trigger: { id, ...c.body } }; }
  else if (c.action === 'update') { const t = st.routines.find(x => x.id === c.trigger_id); Object.assign(t, c.body); r = { trigger: t }; }
  else if (c.action === 'run') { st.runs.push({ id: 'cse_' + st.runs.length, trigger: c.trigger_id, created_at: new Date().toISOString(), title: '⚡ ' + (st.routines.find(x => x.id === c.trigger_id)?.name || ''), status: 'active' }); r = { ok: true }; }
  else if (c.action === 'list_runs') r = { data: st.runs.filter(x => x.trigger === c.trigger_id) };
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'RemoteTrigger', input: c }] } });
  out({ type: 'user', message: { content: [{ type: 'tool_result', content: 'HTTP 200\n' + JSON.stringify(r) }] } });
}
save();
out({ type: 'result', subtype: 'success', is_error: false, result: 'DONE' });

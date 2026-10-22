// הרצת התוכנה מול שירותים מדומים (גוגל, clasp, Claude Code, קלוד, ימות, GitHub), לבדיקה בדפדפן:
//   node tests/fake/dev.mjs [--keep] [--block] [--noenv]   ואז http://127.0.0.1:8789/?t=dev
//   --block: כתובת הסקריפט חסומה מהמחשב.  --noenv: אין רוטינות בחשבון claude.ai.  --keep: לא למחוק את המצב הקודם.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const data = join(tmpdir(), 'claude-wake-dev');
const flag = (f) => process.argv.includes(f);
if (!flag('--keep')) rmSync(data, { recursive: true, force: true });
mkdirSync(data, { recursive: true });
const env = {
  ...process.env, CLAUDE_WAKE_DATA: data, CLAUDE_WAKE_CLASP: join(here, 'fake-clasp.mjs'), FAKE_STATE: join(data, 'fake-clasp.json'),
  CLAUDE_WAKE_CLAUDE: join(here, 'fake-claude.mjs'), FAKE_CLAUDE_STATE: join(data, 'fake-claude.json'),
  CLAUDE_WAKE_SCRIPT_SRC: join(root, 'src'), CLAUDE_WAKE_EXEC_BASE: 'http://127.0.0.1:8790', CLAUDE_WAKE_NO_EXTERNAL: '1',
  CLAUDE_WAKE_DEV_PORT: '8789', CLAUDE_WAKE_DEV_TOKEN: 'dev',
  ...(flag('--block') ? { FAKE_BLOCK: '1' } : {}), ...(flag('--noenv') ? { FAKE_CLAUDE_NOENV: '1' } : {}),
};
const g = spawn(process.execPath, [join(here, 'fake-google.mjs'), '8790', join(data, 'script')], { stdio: 'inherit', env });
const s = spawn(process.execPath, ['--import', pathToFileURL(join(here, 'preload.mjs')).href, join(root, 'app', 'server.mjs'), '--no-open'], { stdio: 'inherit', env });
const stop = () => { g.kill(); s.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
s.on('exit', stop);

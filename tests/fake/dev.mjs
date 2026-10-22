// הרצת התוכנה מול גוגל ו-clasp מדומים, לבדיקה ידנית בדפדפן: http://127.0.0.1:8789/?t=dev
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const data = join(tmpdir(), 'claude-wake-dev');
if (!process.argv.includes('--keep')) rmSync(data, { recursive: true, force: true });
mkdirSync(data, { recursive: true });
const g = spawn(process.execPath, [join(here, 'fake-google.mjs'), '8790', join(data, 'config.json')], { stdio: 'inherit' });
const s = spawn(process.execPath, [join(root, 'app', 'server.mjs'), '--no-open'], {
  stdio: 'inherit',
  env: {
    ...process.env, CLAUDE_WAKE_DATA: data, CLAUDE_WAKE_CLASP: join(here, 'fake-clasp.mjs'), FAKE_STATE: join(data, 'fake-clasp.json'),
    CLAUDE_WAKE_SCRIPT_SRC: join(root, 'src'), CLAUDE_WAKE_EXEC_BASE: 'http://127.0.0.1:8790', CLAUDE_WAKE_NO_EXTERNAL: '1',
    CLAUDE_WAKE_DEV_PORT: '8789', CLAUDE_WAKE_DEV_TOKEN: 'dev',
  },
});
const stop = () => { g.kill(); s.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
s.on('exit', stop);

// נתיבים: תיקיית התוכנה (בהתקנה: %LOCALAPPDATA%\ClaudeWake\app) ותיקיית הנתונים (%APPDATA%\ClaudeWake).
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const DATA_DIR = process.env.CLAUDE_WAKE_DATA || join(process.env.APPDATA || join(homedir(), '.config'), 'ClaudeWake');
export const CONFIG_FILE = join(DATA_DIR, 'config.json');
export const UI_FILE = join(DATA_DIR, 'ui.json');
export const LOG_FILE = join(DATA_DIR, 'app.log');
export const PROJECT_DIR = join(DATA_DIR, 'script');
/** קוד הסקריפט שעולה לגוגל: בהתקנה app\script, בפיתוח src. */
export const SCRIPT_SRC = process.env.CLAUDE_WAKE_SCRIPT_SRC || join(APP_DIR, 'script');
/** clasp ארוז לקובץ אחד (בנתיב עם עברית clasp לא נטען מ-node_modules). */
export const CLASP = process.env.CLAUDE_WAKE_CLASP || join(APP_DIR, 'clasp', 'clasp.mjs');

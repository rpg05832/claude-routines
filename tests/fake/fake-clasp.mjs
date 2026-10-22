// clasp מדומה לבדיקות: מתנהג כמו clasp אמיתי בפקודות שהתוכנה משתמשת בהן. המצב בקובץ FAKE_STATE.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STATE = process.env.FAKE_STATE;
const st = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { loggedIn: false, apiEnabled: false, pushes: 0, deploys: 0 };
const save = () => writeFileSync(STATE, JSON.stringify(st));
const [cmd, ...rest] = process.argv.slice(2);
const out = (s, code = 0) => { console.log(s); save(); process.exit(code); };

switch (cmd) {
  case 'show-authorized-user': out(JSON.stringify(st.loggedIn ? { loggedIn: true, email: 'ab1234@gmail.com' } : { loggedIn: false }, null, 2));
  case 'login': st.loggedIn = true; out('Authorization successful.\nYou are logged in as ab1234@gmail.com.');
  case 'logout': st.loggedIn = false; out('Logged out.');
  case 'list-scripts':
    if (!st.loggedIn) out('No credentials found.', 1);
    if (!st.apiEnabled) { st.apiEnabled = true; out('User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings', 1); }
    out('[]');
  case 'create-script':
    writeFileSync(join(process.cwd(), '.clasp.json'), JSON.stringify({ scriptId: 'FAKE_SCRIPT_ID', rootDir: '.' }));
    writeFileSync(join(process.cwd(), 'Code.js'), '// default');
    out('Created new script: https://script.google.com/d/FAKE_SCRIPT_ID/edit');
  case 'push':
    if (!existsSync(join(process.cwd(), 'Secrets.gs'))) out('Secrets.gs missing', 1);
    st.pushes++; st.secrets = readFileSync(join(process.cwd(), 'Secrets.gs'), 'utf8'); out('Pushed 3 files.');
  case 'create-deployment': st.deploys++; out('Deployed AKfycbFAKEDEPLOYMENT1234567890 @1');
  case 'update-deployment': st.deploys++; out('Deployed ' + rest[0] + ' @2');
  default: out('unknown command ' + cmd, 1);
}

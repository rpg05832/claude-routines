// בדיקות למסלול "מהמחשב": זיהוי פרופילים, אימות הגדרות, pc.json ותחביר הסקריפטים. הרצה: node --test tests/test_pc.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.CLAUDE_WAKE_DATA = mkdtempSync(join(tmpdir(), 'cw-pc-'));
const pc = await import('../app/lib/pc.mjs');

function fakeBrowsers() {
  const root = mkdtempSync(join(tmpdir(), 'cw-br-'));
  const local = join(root, 'local'), pf = join(root, 'pf');
  mkdirSync(join(pf, 'Google', 'Chrome', 'Application'), { recursive: true });
  writeFileSync(join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), '');
  mkdirSync(join(local, 'Google', 'Chrome', 'User Data'), { recursive: true });
  writeFileSync(join(local, 'Google', 'Chrome', 'User Data', 'Local State'), JSON.stringify({ profile: { info_cache: {
    'Profile 2': { name: 'עבודה', user_name: 'ab1234@gmail.com' }, Default: { name: 'אישי', user_name: '' },
  } } }));
  // Edge בלי Local State: לא מופיע
  mkdirSync(join(pf, 'Microsoft', 'Edge', 'Application'), { recursive: true });
  writeFileSync(join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '');
  return { LOCALAPPDATA: local, ProgramFiles: pf };
}

test('פרופילים של דפדפנים מתוך Local State', () => {
  const list = pc.listProfiles(fakeBrowsers());
  assert.deepEqual(list.map(p => p.key), ['Chrome|Default', 'Chrome|Profile 2']);
  assert.equal(list[1].label, 'עבודה'); assert.equal(list[1].email, 'ab1234@gmail.com');
  assert.match(list[0].exe, /chrome\.exe$/);
});

test('אימות הגדרות הדפדפן והחשמל', () => {
  const p = pc.applyPc({}, { profileKey: 'Chrome|Default', minWait: '5', maxWait: 120, minBattery: 30, keepAwake: false });
  assert.equal(p.minWait, 5); assert.equal(p.maxWait, 120); assert.equal(p.keepAwake, false); assert.equal(p.url, 'https://claude.ai/new');
  assert.throws(() => pc.applyPc(p, { url: 'http://claude.ai' }), /https/);
  assert.throws(() => pc.applyPc(p, { maxWait: 5 }), /לא תקין/);
  assert.throws(() => pc.applyPc(p, { tabCount: 99 }), /לא תקין/);
});

test('pc.json לסקריפט השליחה', () => {
  const profiles = pc.listProfiles(fakeBrowsers());
  const p = pc.applyPc({}, { profileKey: 'Chrome|Profile 2' });
  const settings = { keys: [{ digit: '1', name: 'הדלקה', text: "שלום, מה שלומך? 'בדיקה'", connectionId: 'main' }], schedules: [{ id: 's', enabled: true, time: '07:05', days: [0, 4], digit: '1' }] };
  pc.writePcConfig(p, settings, profiles);
  const c = JSON.parse(readFileSync(pc.PC_CONFIG, 'utf8'));
  assert.equal(c.profileFolder, 'Profile 2'); assert.match(c.browserExe, /chrome\.exe$/);
  assert.equal(c.keys[0].text, "שלום, מה שלומך? 'בדיקה'");
  assert.deepEqual(c.schedules[0], { enabled: true, time: '07:05', days: [0, 4], digit: '1' });
  assert.throws(() => pc.writePcConfig(pc.applyPc({}, { profileKey: 'Brave|X' }), settings, profiles), /לבחור פרופיל/);
});

test('תחביר הסקריפטים של PowerShell, עם סימון UTF-8', { skip: process.platform !== 'win32' }, () => {
  const dir = fileURLToPath(new URL('../app/pc/', import.meta.url));
  for (const f of ['send.ps1', 'keepawake.ps1']) {
    const buf = readFileSync(join(dir, f));
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], f + ' צריך BOM (עברית ב-PowerShell 5.1)');
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${join(dir, f).replace(/'/g, "''")}', [ref]$null, [ref]$e); if($e){'ERR '+($e|%{$_.Message})} else {'OK'}`], { encoding: 'utf8' });
    assert.equal(out.trim(), 'OK', f);
  }
});

#!/usr/bin/env python3
"""הדלקת קלוד, גרסת GitHub Actions. ספרייה סטנדרטית בלבד.

  python3 wake.py               בדיקת תזמונים (מופעל מ-cron של GitHub)
  python3 wake.py --key 1       שליחה מיידית של מקש 1 (כפתור Run workflow)

ההגדרות ב-wake.json. כתובת ההפעלה והטוקן של הרוטינה מגיעים מ-Secrets:
  CLAUDE_FIRE_URL, CLAUDE_FIRE_TOKEN       (חיבור ברירת המחדל)
  CLAUDE_FIRE_URL_<שם>, CLAUDE_FIRE_TOKEN_<שם>   (חיבור נוסף, לפי "connection" במקש)
מצב "מה כבר רץ היום" נשמר בקובץ .wake-state.json שעובר בין ריצות דרך actions/cache.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Jerusalem")
FIRE_URL_RE = re.compile(r"^https://api\.anthropic\.com/v1/claude_code/routines/trig_[A-Za-z0-9]+/fire$")
BETA_HEADER = "experimental-cc-routine-2026-04-01"
HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, ".wake-state.json")


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def due_now(s, dow, mins, window):
    """האם תזמון צריך לרוץ עכשיו. dow: 0=ראשון. mins: דקות מתחילת היום."""
    if not s.get("enabled", True) or dow not in s.get("days", []):
        return False
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", str(s.get("time", "")))
    if not m:
        return False
    at = int(m[1]) * 60 + int(m[2])
    return at <= mins < at + window


def schedule_id(s):
    return f"{s.get('time')}-{s.get('digit')}-{''.join(map(str, s.get('days', [])))}"


def connection(name, env):
    sfx = f"_{name.upper()}" if name else ""
    return env.get("CLAUDE_FIRE_URL" + sfx, "").strip(), env.get("CLAUDE_FIRE_TOKEN" + sfx, "").strip()


def fire(url, token, text, opener=urllib.request.urlopen):
    if not FIRE_URL_RE.match(url):
        return False, "כתובת ההפעלה חסרה או לא תקינה (Secret בשם CLAUDE_FIRE_URL)"
    if not token:
        return False, "חסר טוקן (Secret בשם CLAUDE_FIRE_TOKEN)"
    req = urllib.request.Request(
        url,
        data=json.dumps({"text": text} if text else {}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "anthropic-beta": BETA_HEADER,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )
    try:
        with opener(req, timeout=30) as r:
            body = json.loads(r.read().decode("utf-8") or "{}")
        return True, "נשלח " + body.get("claude_code_session_url", "")
    except urllib.error.HTTPError as e:
        hint = {401: "הטוקן לא תקין", 403: "הטוקן לא תקין", 429: "יותר מדי הפעלות או שמכסת השימוש נגמרה"}.get(e.code, "")
        return False, f"קלוד החזיר {e.code} {hint}".strip()
    except Exception as e:  # noqa: BLE001
        return False, f"החיבור לקלוד נכשל: {e}"


def run(argv, env=os.environ, now=None, opener=urllib.request.urlopen, cfg=None, state=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", default="")
    args = ap.parse_args(argv)
    cfg = cfg if cfg is not None else load_json(os.path.join(HERE, "wake.json"), {})
    state = state if state is not None else load_json(STATE_FILE, {})
    keys = {str(k["digit"]): k for k in cfg.get("keys", [])}
    window = int(cfg.get("windowMinutes", 20))
    now = (now or dt.datetime.now(TZ)).astimezone(TZ)
    today = now.strftime("%Y-%m-%d")
    dow = (now.weekday() + 1) % 7
    mins = now.hour * 60 + now.minute

    todo = []
    if args.key:
        todo.append((args.key.strip(), "כפתור", None))
    else:
        for s in cfg.get("schedules", []):
            sid = schedule_id(s)
            if due_now(s, dow, mins, window) and state.get(sid) != today:
                state[sid] = today   # נרשם לפני השליחה: עדיף פספוס על כפילות
                todo.append((str(s.get("digit")), "תזמון " + s.get("time", ""), sid))

    lines, failed = [], False
    for digit, source, _ in todo:
        k = keys.get(digit)
        if not k:
            lines.append(f"✗ {source}: אין מקש {digit} ב-wake.json")
            failed = True
            continue
        url, token = connection(k.get("connection", ""), env)
        ok, msg = fire(url, token, k.get("text", ""), opener)
        if token:
            msg = msg.replace(token, "***")
        lines.append(f"{'✓' if ok else '✗'} {source}: {k.get('name', digit)} - {msg}")
        failed |= not ok
    if not todo:
        lines.append(f"אין מה לשלוח עכשיו ({now:%H:%M} שעון ישראל)")
    return lines, failed, state


def main():
    lines, failed, state = run(sys.argv[1:])
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    out = "\n".join(lines)
    print(out)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### הדלקת קלוד\n\n" + "\n".join("- " + ln for ln in lines) + "\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

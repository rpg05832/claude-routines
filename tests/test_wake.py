"""בדיקות לגרסת GitHub. הרצה: python -m unittest discover -s tests"""
import datetime as dt
import io
import json
import os
import sys
import unittest
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "github"))
import wake  # noqa: E402

URL = "https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire"
ENV = {"CLAUDE_FIRE_URL": URL, "CLAUDE_FIRE_TOKEN": "sk-secret-123"}
CFG = {
    "windowMinutes": 20,
    "keys": [{"digit": "1", "name": "הדלקה", "text": "בוקר טוב"}, {"digit": "2", "name": "אחר", "text": "x", "connection": "work"}],
    "schedules": [{"enabled": True, "time": "07:10", "days": [0, 1, 2, 3, 4], "digit": "1"}],
}


def at(y, mo, d, h, mi):
    return dt.datetime(y, mo, d, h, mi, tzinfo=wake.TZ)


class Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Recorder:
    def __init__(self, fail_code=None):
        self.calls, self.fail_code = [], fail_code

    def __call__(self, req, timeout=30):
        self.calls.append(req)
        if self.fail_code:
            raise urllib.error.HTTPError(req.full_url, self.fail_code, "x", {}, None)
        return Resp(json.dumps({"claude_code_session_url": "https://claude.ai/code/session_1"}).encode())


class WakeTests(unittest.TestCase):
    def test_schedule_fires_once_per_day(self):
        rec = Recorder()
        state = {}
        # 2026-10-25 הוא יום ראשון
        lines, failed, state = wake.run([], ENV, at(2026, 10, 25, 7, 12), rec, CFG, state)
        self.assertFalse(failed)
        self.assertEqual(len(rec.calls), 1)
        req = rec.calls[0]
        self.assertEqual(req.full_url, URL)
        self.assertEqual(req.get_header("Authorization"), "Bearer sk-secret-123")
        self.assertEqual(req.get_header("Anthropic-beta"), wake.BETA_HEADER)
        self.assertEqual(json.loads(req.data), {"text": "בוקר טוב"})
        wake.run([], ENV, at(2026, 10, 25, 7, 22), rec, CFG, state)
        self.assertEqual(len(rec.calls), 1, "לא שולח פעמיים באותו יום")
        wake.run([], ENV, at(2026, 10, 26, 7, 10), rec, CFG, state)
        self.assertEqual(len(rec.calls), 2, "שולח שוב ביום הבא")

    def test_window_and_days(self):
        rec = Recorder()
        wake.run([], ENV, at(2026, 10, 25, 7, 9), rec, CFG, {})     # לפני השעה
        wake.run([], ENV, at(2026, 10, 25, 7, 30), rec, CFG, {})    # אחרי החלון
        wake.run([], ENV, at(2026, 10, 30, 7, 12), rec, CFG, {})    # שישי, לא ברשימה
        self.assertEqual(rec.calls, [])

    def test_israel_time_across_dst(self):
        # 07:10 שעון ישראל לפני ואחרי סוף שעון הקיץ (25.10.2026) = שעות UTC שונות
        rec = Recorder()
        before = dt.datetime(2026, 10, 22, 4, 12, tzinfo=dt.timezone.utc)   # 07:12 IDT
        after = dt.datetime(2026, 10, 26, 5, 12, tzinfo=dt.timezone.utc)    # 07:12 IST
        wake.run([], ENV, before, rec, CFG, {})
        wake.run([], ENV, after, rec, CFG, {})
        self.assertEqual(len(rec.calls), 2)

    def test_manual_key_and_missing_secret(self):
        rec = Recorder()
        lines, failed, _ = wake.run(["--key", "1"], ENV, at(2026, 10, 25, 13, 0), rec, CFG, {})
        self.assertFalse(failed)
        self.assertEqual(len(rec.calls), 1)
        lines, failed, _ = wake.run(["--key", "2"], ENV, at(2026, 10, 25, 13, 0), rec, CFG, {})
        self.assertTrue(failed, "חיבור work בלי Secret משלו נכשל בבירור")
        self.assertIn("CLAUDE_FIRE_URL", " ".join(lines))
        lines, failed, _ = wake.run(["--key", "9"], ENV, at(2026, 10, 25, 13, 0), rec, CFG, {})
        self.assertTrue(failed)

    def test_rejects_foreign_url_and_hides_token(self):
        rec = Recorder()
        env = {"CLAUDE_FIRE_URL": "https://evil.example/fire", "CLAUDE_FIRE_TOKEN": "sk-secret-123"}
        lines, failed, _ = wake.run(["--key", "1"], env, at(2026, 10, 25, 13, 0), rec, CFG, {})
        self.assertTrue(failed)
        self.assertEqual(rec.calls, [], "הטוקן לא נשלח לכתובת זרה")
        lines, failed, _ = wake.run(["--key", "1"], ENV, at(2026, 10, 25, 13, 0), Recorder(401), CFG, {})
        self.assertTrue(failed)
        self.assertNotIn("sk-secret-123", " ".join(lines))


if __name__ == "__main__":
    unittest.main()

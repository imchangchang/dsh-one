#!/usr/bin/env python3
"""Unit tests for mk-sessions-modern.py --tag bridge client (#18 contract).

Covers the script-side bridge client in `assign_tag(sids, tag_name, bridge_file)`:
reads bridge.json {port, token} -> POST 127.0.0.1:<port>/tag with header
`Authorization: Bearer <token>` and body `{"group", "sessionIds"}`. Verifies the
request shape and every error path (missing/invalid record, HTTP error incl. 401,
connect failure, bridge assign failure).

script filename uses hyphens (mk-sessions-modern.py), which Python cannot import
by name, so we load it by path with importlib.

Run (from this directory):
    python3 -m unittest test_mk_sessions_bridge -v
"""
import importlib.util
import io
import json
import os
import tempfile
import unittest
from unittest import mock

import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location("mk_sessions_modern",
                                              os.path.join(HERE, "mk-sessions-modern.py"))
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


def _write(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


class _FakeResp:
    """Minimal context-manager response for mocked urlopen (success path)."""

    def __init__(self, body: bytes):
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class BridgeFileReadTest(unittest.TestCase):
    def test_missing_file_points_to_extension_not_loaded(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(SystemExit) as cm:
                m.assign_tag(["a"], "g", os.path.join(d, "nope.json"))
            self.assertIn("cannot read", str(cm.exception))
            self.assertIn("DSH One 扩展未加载", str(cm.exception))

    def test_invalid_record_missing_token_errors(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "bridge.json")
            _write(p, '{"port": 9999}')
            with self.assertRaises(SystemExit) as cm:
                m.assign_tag(["a"], "g", p)
            self.assertIn("缺 port/token 或格式不对", str(cm.exception))

    def test_invalid_record_port_not_int_errors(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "bridge.json")
            _write(p, '{"port": "9999", "token": "tok"}')
            with self.assertRaises(SystemExit) as cm:
                m.assign_tag(["a"], "g", p)
            self.assertIn("缺 port/token 或格式不对", str(cm.exception))


class AssignTagRequestTest(unittest.TestCase):
    def test_posts_group_and_session_ids_and_prints(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "bridge.json")
            _write(p, '{"port": 9999, "token": "tok"}')
            body = json.dumps({"ok": True, "tag": {"id": "t-1", "name": "g"}, "sessionCount": 2}).encode()
            with mock.patch("urllib.request.urlopen", return_value=_FakeResp(body)) as uo, \
                    mock.patch("sys.stdout") as stdout:
                m.assign_tag(["a", "b"], "g", p)
        self.assertEqual(uo.call_count, 1)
        req = uo.call_args[0][0]
        self.assertEqual(req.full_url, "http://127.0.0.1:9999/tag")
        headers = dict(req.header_items())
        self.assertEqual(headers.get("Authorization"), "Bearer tok")
        self.assertEqual(json.loads(req.data.decode()),
                         {"group": "g", "sessionIds": ["a", "b"]})
        printed = "".join(c[0][0] for c in stdout.write.call_args_list)
        self.assertIn("t-1", printed)
        self.assertIn("2 sessions", printed)


class AssignTagHttpErrorTest(unittest.TestCase):
    def _http_error(self, code, msg):
        url = "http://127.0.0.1:9999/tag"
        return urllib.error.HTTPError(url, code, msg, None, io.BytesIO(b'{"ok":false,"error":"E"}'))

    def test_http_401_hints_stale_token(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "bridge.json")
            _write(p, '{"port": 9999, "token": "tok"}')
            with mock.patch("urllib.request.urlopen", side_effect=self._http_error(401, "Unauthorized")), \
                    self.assertRaises(SystemExit) as cm:
                m.assign_tag(["a"], "g", p)
        self.assertIn("HTTP 401", str(cm.exception))
        self.assertIn("token 被拒", str(cm.exception))

    def test_http_other_status_reports_code_and_detail(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "bridge.json")
            _write(p, '{"port": 9999, "token": "tok"}')
            with mock.patch("urllib.request.urlopen", side_effect=self._http_error(500, "Internal Server Error")), \
                    self.assertRaises(SystemExit) as cm:
                m.assign_tag(["a"], "g", p)
        self.assertIn("HTTP 500", str(cm.exception))
        self.assertIn("Internal Server Error", str(cm.exception))


class AssignTagUrlerrorTest(unittest.TestCase):
    def test_connect_failure_reports_and_hints_reload(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "bridge.json")
            _write(p, '{"port": 9999, "token": "tok"}')
            err = urllib.error.URLError("connection refused")
            with mock.patch("urllib.request.urlopen", side_effect=err), \
                    self.assertRaises(SystemExit) as cm:
                m.assign_tag(["a"], "g", p)
        self.assertIn("bridge POST /tag failed (connect)", str(cm.exception))
        self.assertIn("reload 扩展窗口", str(cm.exception))


class AssignTagResponseErrorTest(unittest.TestCase):
    def test_assign_failed_reports_error(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "bridge.json")
            _write(p, '{"port": 9999, "token": "tok"}')
            body = json.dumps({"ok": False, "error": "unknown-session"}).encode()
            with mock.patch("urllib.request.urlopen", return_value=_FakeResp(body)), \
                    self.assertRaises(SystemExit) as cm:
                m.assign_tag(["a"], "g", p)
        self.assertIn("bridge assign tag failed", str(cm.exception))
        self.assertIn("unknown-session", str(cm.exception))


if __name__ == "__main__":
    unittest.main()

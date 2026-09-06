#!/usr/bin/env python3
"""Batch-create top-level sessions against a dsh 0.1.2+ gateway (modern wire).

Usage:
  python3 mk-sessions-modern.py --tasks tasks.json [--repo /abs/path] [--owned ~/.dsh/dsh-owned.json]
                                [--base http://127.0.0.1:3080] [--token TOKEN] [--dry-run]

tasks.json format:
  [
    {"title": "dev: one", "prompt": "complete task instructions..."},
    ...
  ]

Every RPC carries a browser-session auth cookie exchanged from the launch
token (GET /?token=...); the token itself cannot call APIs.
--repo defaults to the current directory; it must already be (or become) a
registered workspace, the new sessions are attached to it by workspaceId.
No third-party dependencies (python3 stdlib only).
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.parse
import urllib.error
import uuid

BASE_DEFAULT = None  # filled from dsh-owned.json


def http(base, method, payload, cookie=None, timeout=20):
    """POST /api/<method>; modern wire already applied by caller."""
    data = json.dumps({"type": "client-request", "rpcId": str(uuid.uuid4()),
                       "method": method, "payload": payload}).encode()
    req = urllib.request.Request(f"{base}/api/{method}", data=data, method="POST")
    req.add_header("content-type", "application/json")
    if cookie:
        req.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            doc = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} {e.reason}: {e.read().decode()[:200]}")
    if doc.get("rpcId") is None or not doc.get("result"):
        sys.exit(f"{method}: bad gateway response: {json.dumps(doc)[:200]}")
    if not doc["result"]["ok"]:
        err = doc["result"]["error"]
        sys.exit(f"{method} failed: {err['code']} {err['message']}")
    return doc["result"]["value"]


def auth_cookie(base, token):
    """GET /?token=... exchanges the launch token for the session cookie."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        """Stop following the exchange 303: the follow-up drops the token -> 401."""

        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    opener = urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(f"{base}/?token={urllib.parse.quote(token)}")
    raw = ""
    try:
        with opener.open(req, timeout=10) as resp:
            raw = resp.headers.get("Set-Cookie") or ""
    except urllib.error.HTTPError as e:
        # The exchange answers a 303; with NoRedirect it surfaces as HTTPError
        # and the Set-Cookie rides on that response's headers.
        if e.code != 303:
            sys.exit(f"token exchange failed: HTTP {e.code}")
        raw = e.headers.get("Set-Cookie") or ""
    if not raw:
        sys.exit("token exchange returned no Set-Cookie (stale token? gateway restarted?)")
    return raw.split(";", 1)[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tasks", required=True, help="JSON file: [{\"title\", \"prompt\"}...]")
    ap.add_argument("--repo", default=os.path.realpath("."), help="workspace path (default: cwd)")
    ap.add_argument("--owned", default=os.path.expanduser("~/.dsh/dsh-owned.json"),
                    help="dsh-owned.json (default: ~/.dsh/dsh-owned.json)")
    ap.add_argument("--base", default=None, help="override gateway base URL")
    ap.add_argument("--token", default=None, help="override launch token")
    ap.add_argument("--dry-run", action="store_true", help="resolve & validate only; no sessions")
    args = ap.parse_args()

    owned = {}
    if args.base is None or args.token is None:
        try:
            with open(args.owned, encoding="utf-8") as f:
                owned = json.load(f)
        except OSError:
            if args.base is None or args.token is None:
                sys.exit(f"cannot read {args.owned}; pass --base/--token explicitly")

    base = args.base or f"http://127.0.0.1:{owned['port']}"
    token = args.token or owned.get("token")
    if token is None:
        sys.exit("no launch token (0.1.1 gateway? use mk-sessions-legacy.py)")
    cookie = auth_cookie(base, token)

    # Probe + workspace id
    http(base, "session/list", {"args": {"_request": {}}}, cookie)
    ws_info = http(base, "workspace/create", {"args": {"request": {"path": args.repo}}}, cookie)
    ws = ws_info["workspace"]
    print(f"workspace: {ws['title']} ({ws['workspaceId']})")

    with open(args.tasks, encoding="utf-8") as f:
        tasks = json.load(f)

    created, names = {}, {}
    for i, t in enumerate(tasks, 1):
        title, prompt = t["title"], t["prompt"]
        names[i] = title
        if not title or not prompt:
            print(f"[{i}] SKIP (missing title/prompt): {title!r}")
            continue
        if args.dry_run:
            print(f"[{i}] DRY-RUN would create: {title}")
            continue
        sid = None
        for attempt in (1, 2):
            sid = http(base, "session/create",
                       {"args": {"request": {"workspaceId": ws["workspaceId"]}}}, cookie)["sessionId"]
            http(base, "session/rename",
                 {"args": {"request": {"sessionId": sid, "title": title}}}, cookie)
            http(base, "session/prompt",
                 {"args": {"request": {"requestId": str(uuid.uuid4()), "sessionId": sid,
                                       "mode": "queue",
                                       "content": [{"type": "text", "text": prompt}]}}}, cookie,
                 timeout=60)
            # verify attachment (known one-off: create returns ok but sessionIds misses it)
            cur = http(base, "workspace/create",
                       {"args": {"request": {"path": args.repo}}}, cookie)["workspace"]
            if sid in cur["sessionIds"]:
                break
            print(f"[{i}] attach miss on attempt {attempt}; cancel+archive, retry")
            http(base, "session/cancel", {"args": {"request": {"sessionId": sid}}}, cookie)
            http(base, "workspace/archiveSession", {"args": {"request": {"sessionId": sid}}}, cookie)
            sid = None
        created[i] = sid
        tag = sid[-12:] if sid else "FAILED"
        print(f"[{i}] {title}  session-{tag}")

    print("\nsessions:")
    for i, t in enumerate(tasks, 1):
        if created.get(i):
            print(f"- {t['title']}  ({created[i]})")


if __name__ == "__main__":
    main()

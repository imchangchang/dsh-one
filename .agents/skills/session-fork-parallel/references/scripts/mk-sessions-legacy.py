#!/usr/bin/env python3
"""Batch-create top-level sessions against a dsh 0.1.1 gateway (legacy wire).

Usage:
  python3 mk-sessions-legacy.py --tasks tasks.json [--repo /abs/path] [--base http://127.0.0.1:3080]
                                [--dry-run]

tasks.json format:
  [
    {"title": "dev: one", "prompt": "complete task instructions..."},
    ...
  ]

0.1.1 has no browser-session auth: raw POST, dot-method names, un-wrapped
payloads. --repo defaults to the current directory; must be a registered
workspace (or registered via workspace.list lookup by path — see note).
No third-party dependencies (python3 stdlib only).
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
import uuid


def http(base, method, payload, timeout=20):
    """POST /api/<dot-method>, legacy payload verbatim."""
    data = json.dumps({"type": "client-request", "rpcId": str(uuid.uuid4()),
                       "method": method, "payload": payload}).encode()
    req = urllib.request.Request(f"{base}/api/{method}", data=data, method="POST")
    req.add_header("content-type", "application/json")
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


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tasks", required=True, help="JSON file: [{\"title\", \"prompt\"}...]")
    ap.add_argument("--repo", default=os.path.realpath("."), help="workspace path (default: cwd)")
    ap.add_argument("--base", default="http://127.0.0.1:3080", help="gateway base URL")
    ap.add_argument("--dry-run", action="store_true", help="resolve & validate only; no sessions")
    args = ap.parse_args()

    # Probe + workspace id via workspace.list (items[].path match)
    ws_list = http(args.base, "workspace.list", {})["items"]
    ws = next((w for w in ws_list if w["path"] == args.repo), None)
    if ws is None:
        ws = http(args.base, "workspace.create", {"path": args.repo})["workspace"]
    print(f"workspace: {ws['title']} ({ws['workspaceId']})")

    with open(args.tasks, encoding="utf-8") as f:
        tasks = json.load(f)

    created = {}
    for i, t in enumerate(tasks, 1):
        title, prompt = t["title"], t["prompt"]
        if not title or not prompt:
            print(f"[{i}] SKIP (missing title/prompt): {title!r}")
            continue
        if args.dry_run:
            print(f"[{i}] DRY-RUN would create: {title}")
            continue
        sid = http(args.base, "session.create", {"workspaceId": ws["workspaceId"]})["sessionId"]
        http(args.base, "session.rename", {"sessionId": sid, "title": title})
        http(args.base, "session.prompt",
             {"sessionId": sid, "mode": "queue", "content": [{"type": "text", "text": prompt}]},
             timeout=60)
        cur = next((w for w in http(args.base, "workspace.list", {})["items"]
                    if w["path"] == args.repo), None)
        attached = cur is not None and sid in cur["sessionIds"]
        created[i] = sid if attached else None
        print(f"[{i}] {title}  session-{sid[-12:]}  attach={'ok' if attached else 'MISSING (GUI list may hide it; verify + recreate)'}")

    print("\nsessions:")
    for i, t in enumerate(tasks, 1):
        if created.get(i):
            print(f"- {t['title']}  ({created[i]})")


if __name__ == "__main__":
    main()

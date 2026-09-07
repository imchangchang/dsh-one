#!/usr/bin/env python3
"""Batch-create top-level sessions against a dsh 0.1.2+ gateway (modern wire).

Usage:
  python3 mk-sessions-modern.py --tasks tasks.json [--repo /abs/path] [--owned ~/.dsh/dsh-owned.json]
                                [--base http://127.0.0.1:3080] [--token TOKEN] [--dry-run]
                                [--tag "任务名"]

tasks.json format:
  [
    {"title": "dev: one", "prompt": "complete task instructions..."},
    ...
  ]

Every RPC carries a browser-session auth cookie exchanged from the launch
token (GET /?token=...); the token itself cannot call APIs.
--repo defaults to the current directory; it must already be (or become) a
registered workspace, the new sessions are attached to it by workspaceId.
--tag groups all created sessions under one sidebar tag group (Kimi-bridge
style: one batch = one group): after creation it POSTs the bridge with an
explicit action ({"action":"assign","group":<组名>,"sessionIds":[...]}) to the
DSH One extension's loopback bridge (~/.dsh/dsh-one/bridge.json -> port+token),
which then writes ~/.dsh/dsh-one/tags.json via its store. The agent process no
longer writes the client-state file directly (that is outside the workspace and
gets blocked by the dsh file sandbox); the extension does it instead.
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

# ---- --tag：经扩展 loopback 桥代写 tags.json（#18）----
# 扩展激活时在 127.0.0.1 起随机端口 + 每进程 token，写 ~/.dsh/dsh-one/bridge.json
# {port, token}。本脚本只 POST 一次 /tag，tags.json 的找/建组/颜色轮换/原子写全部
# 由扩展进程完成——agent 进程不再直写工作区外的文件（免沙箱拦截）。
DSH_ONE_BRIDGE_FILE = os.path.expanduser("~/.dsh/dsh-one/bridge.json")


def assign_tag(sids, tag_name, bridge_file=DSH_ONE_BRIDGE_FILE):
    """把 sids 归到名为 tag_name 的标签组：读 bridge.json（port+token）→ POST
    /tag。tags.json 的写由扩展进程代做，本脚本不碰文件。bridge.json 缺失/连接
    失败 = 扩展未加载或记录陈旧，报错指路（不静默）。"""
    try:
        with open(bridge_file, encoding="utf-8") as f:
            bridge = json.load(f)
    except OSError as e:
        sys.exit(
            f"cannot read {bridge_file}: {e}\n"
            "  DSH One 扩展未加载？先在 VS Code 里启动扩展（或 reload 窗口），再重试。"
        )
    port = bridge.get("port")
    token = bridge.get("token")
    if not isinstance(port, int) or not isinstance(token, str) or not token:
        sys.exit(f"{bridge_file} 缺 port/token 或格式不对（扩展未加载/记录陈旧？）")
    # 显式 action（无默认行为）——按组名找/建组并把 sids 归入。
    body = json.dumps({"action": "assign", "group": tag_name, "sessionIds": sids}).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}/tag", data=body, method="POST")
    req.add_header("content-type", "application/json")
    req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            doc = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:200]
        msg = f"bridge POST /tag failed: HTTP {e.code} {e.reason}: {detail}"
        if e.code == 401:
            msg += "\n  token 被拒——bridge.json 记录陈旧？reload 扩展窗口后重试。"
        sys.exit(msg)
    except urllib.error.URLError as e:
        sys.exit(
            f"bridge POST /tag failed (connect): {e.reason}\n"
            "  扩展桥未监听？扩展未加载或已重启——reload 扩展窗口后重试。"
        )
    if not doc.get("ok"):
        sys.exit(f"bridge assign tag failed: {doc.get('error', 'unknown')}")
    tag = doc.get("tag") or {}
    print(f"tag: {tag_name} ({tag.get('id')}) → {doc.get('sessionCount')} sessions")


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
    ap.add_argument("--tag", default=None,
                    help="group all created sessions under this sidebar tag group "
                         "(POSTs to the DSH One loopback bridge; the extension writes "
                         "~/.dsh/dsh-one/tags.json — no direct file write by this script)")
    ap.add_argument("--bridge", default=DSH_ONE_BRIDGE_FILE,
                    help="DSH One tag-bridge record (default: ~/.dsh/dsh-one/bridge.json)")
    args = ap.parse_args()
    if args.tag is not None and not args.tag.strip():
        sys.exit("--tag must be a non-empty group name")

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

    if args.tag:
        sids = [sid for i, sid in created.items() if sid]
        if args.dry_run:
            print(f"\nDRY-RUN: --tag {args.tag.strip()!r} would group the created sessions")
        elif sids:
            assign_tag(sids, args.tag.strip(), args.bridge)
        else:
            print("\n--tag skipped: no session was created")


if __name__ == "__main__":
    main()

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
style: one batch = one group): after creation it writes
~/.dsh/dsh-one/tags.json (create the tag by name if missing), which the
DSH One extension picks up via its file watcher.
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

# ---- --tag：写 dsh-one 插件的客户端状态文件（~/.dsh/dsh-one/tags.json）----
# 格式与插件 src/pure/dshStateFile.ts 的 TagFile 对齐：
#   {"version":1, "tags":[{"id","name","color"}], "sessionTags":{sid: tagId}}
# 预设组 id 与自定义组颜色轮换对齐 src/pure/sessionTags.ts（nextCustomColor）。
DSH_ONE_TAGS_FILE = os.path.expanduser("~/.dsh/dsh-one/tags.json")
PRESET_TAG_IDS = {"preset-todo", "preset-doing", "preset-done"}
CUSTOM_TAG_PALETTE = ["orange", "purple", "red"]


def assign_tag(sids, tag_name):
    """把 sids 归到名为 tag_name 的标签组：按 name 找/建 tag → sessionTags[sid]
    = tagId → 原子写（同目录 tmp + replace）。插件 fs.watch 到变化后热重载侧栏。
    文件存在但读不出/格式不认识时报错退出，不覆盖（坏文件由插件按「无文件」
    降级处理，别在这里猜）。"""
    try:
        with open(DSH_ONE_TAGS_FILE, encoding="utf-8") as f:
            doc = json.load(f)
    except FileNotFoundError:
        doc = None
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"{DSH_ONE_TAGS_FILE} exists but is not valid JSON: {e}; refusing to overwrite")
    if doc is None:
        tags, session_tags = [], {}
    elif doc.get("version") != 1 or not isinstance(doc.get("tags"), list) \
            or not isinstance(doc.get("sessionTags"), dict):
        sys.exit(f"{DSH_ONE_TAGS_FILE}: unrecognized shape/version; refusing to overwrite")
    else:
        tags, session_tags = doc["tags"], doc["sessionTags"]
    tag = next((t for t in tags if isinstance(t, dict) and t.get("name") == tag_name), None)
    if tag is None:
        custom = sum(1 for t in tags if isinstance(t, dict) and t.get("id") not in PRESET_TAG_IDS)
        tag = {"id": f"t-{uuid.uuid4()}", "name": tag_name,
               "color": CUSTOM_TAG_PALETTE[custom % len(CUSTOM_TAG_PALETTE)]}
        tags.append(tag)
    for sid in sids:
        session_tags[sid] = tag["id"]
    os.makedirs(os.path.dirname(DSH_ONE_TAGS_FILE), exist_ok=True)
    tmp = f"{DSH_ONE_TAGS_FILE}.tmp.{os.getpid()}.{uuid.uuid4().hex[:8]}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "tags": tags, "sessionTags": session_tags}, f, ensure_ascii=False)
    os.replace(tmp, DSH_ONE_TAGS_FILE)
    print(f"tag: {tag_name} ({tag['id']}, {tag['color']}) → {len(sids)} sessions")


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
                         "(writes ~/.dsh/dsh-one/tags.json; DSH One picks it up via file watch)")
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
            assign_tag(sids, args.tag.strip())
        else:
            print("\n--tag skipped: no session was created")


if __name__ == "__main__":
    main()

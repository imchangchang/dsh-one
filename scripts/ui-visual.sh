#!/usr/bin/env bash
# 用法: scripts/ui-visual.sh [port]
# 在仓库根目录跑（Agent 用）：起 http server 服务仓库根目录，再用 Kimi WebBridge 逐场景
# 打开 test/ui/harness.html?scenario=<name> 并截图到 /tmp/dsh-ui-shots/。
# 前提：WebBridge daemon 在跑（http://127.0.0.1:10086）。失败时先启动 daemon。
# 产出：每个场景一张 PNG + 打印列表，Agent 用 read_image 查看。
set -euo pipefail

PORT="${1:-8899}"
OUT="${DSH_UI_SHOTS:-/tmp/dsh-ui-shots}"
DAEMON="http://127.0.0.1:10086"
SESSION="dsh-ui-visual"
ROOT="$(git rev-parse --show-toplevel)"
mkdir -p "$OUT"

# 场景名列表：严格按 test/ui/scenarios.js 里 window.SCENARIOS 的键
scenarios=($(grep -oE "^ {4}[a-zA-Z0-9'-]+: \{" "$ROOT/test/ui/scenarios.js" | sed -E 's/[[:space:]]*:[[:space:]]*\{.*//' | tr -d "'\"" || true))
if [ "${#scenarios[@]}" -eq 0 ]; then
  echo "未能从 test/ui/scenarios.js 解析出场景名" >&2
  exit 1
fi
echo "场景: ${scenarios[*]}"

# 起 http server（复用同一端口时先杀掉旧的占位进程）
if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then kill "$(lsof -ti tcp:"$PORT")" 2>/dev/null || true; fi
(cd "$ROOT" && python3 -m http.server "$PORT" --bind 127.0.0.1 &>/dev/null &) 
trap 'kill "$(lsof -ti tcp:"$PORT")" 2>/dev/null || true' EXIT
sleep 1

first=1
for s in "${scenarios[@]}"; do
  url="http://127.0.0.1:$PORT/test/ui/harness.html?scenario=$s"
  # 首个开新 tab 并设分组标题，后续复用同一 tab 切到新 URL
  if [ "$first" = "1" ]; then
    curl -s -m 30 -X POST "$DAEMON/command" -H 'Content-Type: application/json' \
      -d "{\"action\":\"navigate\",\"args\":{\"url\":\"$url\",\"newTab\":true,\"group_title\":\"DSH One UI 视觉回归\"},\"session\":\"$SESSION\"}" >/dev/null
    first=0
  else
    curl -s -m 30 -X POST "$DAEMON/command" -H 'Content-Type: application/json' \
      -d "{\"action\":\"navigate\",\"args\":{\"url\":\"$url\"},\"session\":\"$SESSION\"}" >/dev/null
  fi
  sleep 1.2   # 等 webview 渲染
  out="$OUT/$s.png"
  curl -s -m 30 -X POST "$DAEMON/command" -H 'Content-Type: application/json' \
    -d "{\"action\":\"screenshot\",\"args\":{\"format\":\"png\",\"path\":\"$out\"},\"session\":\"$SESSION\"}" >/dev/null
  echo "  $s -> $out"
done

echo "完成，共 ${#scenarios[@]} 张。查看: ls $OUT"

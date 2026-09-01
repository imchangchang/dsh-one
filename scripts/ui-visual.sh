#!/usr/bin/env bash
# 用法: scripts/ui-visual.sh [port] [--mode all|baseline]
# 在仓库根目录跑（Agent 用）：起 http server 服务仓库根目录，用 Kimi WebBridge 逐场景打开
# test/ui/harness.html?scenario=<name> 并截图到 /tmp/dsh-ui-shots/。
#
# 两层模型（场景归属，不是像素基线）：
#   --mode all（默认）     跑 window.SCENARIOS 全部场景 —— worktree 功能验收
#   --mode baseline        只跑 window.BASELINE_SCENARIOS —— 主线合入后的冒烟/回归
#
# 视觉验证方法：脚本先把每个场景的「期望描述」（expect）打印出来，agent 据截图逐条对照
# 核对逻辑与排版是否正确（语义判断，非图和图做像素 diff）。
#
# 前提：WebBridge daemon 在跑（http://127.0.0.1:10086）。失败时先启动 daemon。
set -euo pipefail

PORT=8899; MODE=all
OUT="${DSH_UI_SHOTS:-/tmp/dsh-ui-shots}"
DAEMON="http://127.0.0.1:10086"
SESSION="dsh-ui-visual"
ROOT="$(git rev-parse --show-toplevel)"

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) PORT="$1"; shift ;;
  esac
done
cd "$ROOT"
mkdir -p "$OUT"

# 场景名：baseline 读 BASELINE_SCENARIOS，all 读 SCENARIOS 的键
if [ "$MODE" = "baseline" ]; then
  scenarios=($(python3 -c '
import re
s=open("test/ui/scenarios.js",encoding="utf-8").read()
m=re.search(r"BASELINE_SCENARIOS\s*=\s*\[([\s\S]*?)\]", s)
print(" ".join(re.findall(r"\x27([^\x27]+)\x27", m.group(1))) if m else "")
'))
else
  scenarios=($(grep -oE "^ {4}[a-zA-Z0-9'-]+: \{" test/ui/scenarios.js | sed -E 's/[[:space:]]*:[[:space:]]*\{.*//' | tr -d "'\"" || true))
fi
if [ "${#scenarios[@]}" -eq 0 ]; then
  echo "未能从 test/ui/scenarios.js 解析出场景名（MODE=$MODE）" >&2
  exit 1
fi
echo "mode=$MODE 场景(${#scenarios[@]}): ${scenarios[*]}"

# 打印每个场景的期望描述（agent 读截图后对照核对）
echo
echo "—— 期望清单（读截图后逐条核对）——"
node -e '
const fs=require("fs"), vm=require("vm");
const window={}; const ctx={window, Date, Math};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("test/ui/scenarios.js","utf8"), ctx);
const sc=ctx.window.SCENARIOS;
for(const n of process.argv.slice(1)){ const s=sc[n]; if(s) console.log(`[${n}] ${s.title}: ${s.expect}`); }
' "${scenarios[@]}"
echo

# 起 http server（复用端口时先杀旧占位进程）
if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then kill "$(lsof -ti tcp:"$PORT")" 2>/dev/null || true; fi
(python3 -m http.server "$PORT" --bind 127.0.0.1 &>/dev/null &)
trap 'kill "$(lsof -ti tcp:"$PORT")" 2>/dev/null || true' EXIT
sleep 1

# 清掉该 session 的残留 tab，避免 daemon 在多个 tab 间复用卡住
curl -s -m 15 -X POST "$DAEMON/command" -H 'Content-Type: application/json' \
  -d "{\"action\":\"close_session\",\"args\":{},\"session\":\"$SESSION\"}" >/dev/null 2>&1 || true
sleep 0.5

for s in "${scenarios[@]}"; do
  # _=<ts> 属文档级防缓存：python http.server 无 Cache-Control，浏览器启发式
  # 缓存会在 scenarios.js/dist 更新后仍把旧页面（含旧内联脚本）拿来用。
  url="http://127.0.0.1:$PORT/test/ui/harness.html?scenario=$s&_=$(date +%s%N)"
  # 每场景开一个干净 tab（newTab:true），截图后关闭，避免 tab 累积让 daemon 卡住
  curl -s -m 20 -X POST "$DAEMON/command" -H 'Content-Type: application/json' \
    -d "{\"action\":\"navigate\",\"args\":{\"url\":\"$url\",\"newTab\":true,\"group_title\":\"DSH One UI 视觉验证\"},\"session\":\"$SESSION\"}" >/dev/null
  sleep 1.3
  out="$OUT/$s.png"
  curl -s -m 20 -X POST "$DAEMON/command" -H 'Content-Type: application/json' \
    -d "{\"action\":\"screenshot\",\"args\":{\"format\":\"png\",\"path\":\"$out\"},\"session\":\"$SESSION\"}" >/dev/null
  echo "  $s -> $out"
done

# 清掉累积的 tab 分组（别在循环里 close_tab——快速开关会让 daemon 卡住）
curl -s -m 15 -X POST "$DAEMON/command" -H 'Content-Type: application/json' \
  -d "{\"action\":\"close_session\",\"args\":{},\"session\":\"$SESSION\"}" >/dev/null 2>&1 || true

echo
echo "done; mode=$MODE; ${#scenarios[@]} shots; ls $OUT"

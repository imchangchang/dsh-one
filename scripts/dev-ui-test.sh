#!/usr/bin/env bash
# 用法: scripts/dev-ui-test.sh [要打开的目录]   —— 在 worktree 里运行。
# 构建本 worktree 的 dist 后，起一个与该 worktree 绑定的隔离 VSCode 实例装载这个扩展，
# 人工在窗口里验证功能；验证通过再跑 scripts/dev-finish.sh 打 done 标记。
# 隔离：user-data-dir / extensions-dir 放在 /tmp/dsh-uidev/<slug>/ 下 —— 必须在短路径，
# 因为 VSCode 的 IPC socket 路径（<user-data-dir>/1.x-main.sock）超 103 字符会 EINVAL 启动即退，
# 而 worktree 的实际路径往往很长。不碰日常 VSCode 的设置和扩展；每个 worktree 一份，可并行开。
# 比 F5 轻：普通运行模式，不挂 debugger；要断点调试再用 F5。
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
HOST_DIR="/tmp/dsh-uidev/$(basename "$ROOT")"

if ! command -v code >/dev/null 2>&1; then
  echo "找不到 code 命令：在 VSCode 里 Cmd+Shift+P → 'Shell Command: Install 'code' command in PATH'。" >&2
  exit 1
fi

echo "== 构建 dist =="
npm run build

# 同一 user-data-dir 的实例若已在跑，code 会激活旧窗口而不是新起；
# 旧窗口里扩展还跑着旧代码，需要 Reload Window 加载刚构建的 dist。
if [ -d "$HOST_DIR/user-data" ]; then
  echo
  echo "注意：该 worktree 的隔离实例可能已在跑。如果 VSCode 激活的是旧窗口，"
  echo "按 Cmd+R（Reload Window）加载刚构建的 dist 后再验证。"
  echo
fi

exec code "${1:-$ROOT}" \
  --extensionDevelopmentPath="$ROOT" \
  --user-data-dir="$HOST_DIR/user-data" \
  --extensions-dir="$HOST_DIR/extensions"

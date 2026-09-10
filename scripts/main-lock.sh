#!/usr/bin/env bash
# 主线写锁（source 用，不直接执行）：任何会修改 main 分支历史或主工作区内容的操作
# 都必须先 acquire_main_lock，并且持锁期间不允许别的进程也写 main。
# 锁是 <git-common-dir>/main-write.lock 目录：mkdir 原子获取，同一时刻只有一个进程能拿到；
# 拿不到说明已有别的进程在写主线，调用方直接退出（不要排队等锁——串行合入的约定是
# 「等上一个完全结束后再跑下一个」，报错退出比静默等待更容易让人对齐节奏）。
#
# 用法（在脚本里）：
#   source "$(dirname "$0")/main-lock.sh"
#   acquire_main_lock "dev-merge <slug>"   # 失败时已打印持锁方信息，return 1
#   trap release_main_lock EXIT            # 成功/失败/中断都释放，不留死锁
#
# 适用/不适用：写 main 分支历史、重建主线构建产物的操作要锁；只读 main、或只写
# worktree 自己的分支/tag/dist（dev-start / dev-finish / dev-ui-test）不需要锁。
set -euo pipefail

# 锁目录位置；可用环境变量 MAIN_LOCK_DIR 覆盖（测试或特殊部署用），默认 <git-common-dir>。
_main_lock_dir() {
  if [ -n "${MAIN_LOCK_DIR:-}" ]; then
    printf '%s\n' "$MAIN_LOCK_DIR"
    return 0
  fi
  local common
  common=$(git rev-parse --git-common-dir) || return 1
  case "$common" in
    /*) printf '%s\n' "$common" ;;
    *) printf '%s/%s\n' "$(pwd)" "$common" ;;
  esac
}

acquire_main_lock() {
  local dir
  dir=$(_main_lock_dir) || return 1
  MAIN_LOCK_DIR="$dir"
  LOCK_PATH="$dir/main-write.lock"
  if mkdir "$LOCK_PATH" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_PATH/pid"
    printf '%s\n' "$(date '+%F %T') ${1:-?}" > "$LOCK_PATH/owner"
    MAIN_LOCK_ACQUIRED=1
    return 0
  fi
  local pid owner
  pid=$(cat "${LOCK_PATH}/pid" 2>/dev/null || echo "?")
  owner=$(cat "${LOCK_PATH}/owner" 2>/dev/null || echo "?")
  echo "主线写锁被占用（${LOCK_PATH}，持锁 pid=${pid}，${owner}）。" >&2
  echo "已有别的进程正在写 main，等它完全结束后再重试。" >&2
  echo "若无其他进程在写 main（上次被中断的残留锁），手动删除：rm -rf ${LOCK_PATH}" >&2
  return 1
}

release_main_lock() {
  [ "${MAIN_LOCK_ACQUIRED:-0}" = "1" ] || return 0
  rm -f "$LOCK_PATH/pid" "$LOCK_PATH/owner"
  rmdir "$LOCK_PATH" 2>/dev/null || true
  # 不 unset LOCK_PATH：路径值保留无害，调用方可继续用 [ -d "$LOCK_PATH" ] 检查持有状态；
  # unset 会让 set -u 的调用方引用它时直接报错中断。
  MAIN_LOCK_ACQUIRED=0
}

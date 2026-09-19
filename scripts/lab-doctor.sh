#!/usr/bin/env bash
# 用法: scripts/lab-doctor.sh [--kill]
# 怀疑机器上有实验室留下的孤儿 dsh 实例时跑这条（#192）：缺省只报不动，--kill 才真收。
# 判据与实现都在同目录的 labDoctor.mjs（纯判据 + 命令行），这里只是 POSIX 入口。
set -euo pipefail
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/labDoctor.mjs" "$@"

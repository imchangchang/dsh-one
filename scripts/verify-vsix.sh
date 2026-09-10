#!/usr/bin/env bash
# 校验 vsix 产物：内容（dist/assets/package.json/readme/LICENSE，无 src/test/docs/scripts/.agents/map/ts）
# + 版本 == 期望。供两处共用：
#   - .github/workflows/release.yml：tag 触发构建后校验产物后才挂 GitHub Release
#   - release-gate skill 的独立验收：人工/验收代理对下载的 Release 产物复核
# 用法: scripts/verify-vsix.sh <vsix路径> <期望版本>
set -euo pipefail

vsix="${1:?用法: scripts/verify-vsix.sh <vsix> <期望版本>}"
expect="${2:?用法: scripts/verify-vsix.sh <vsix> <期望版本>}"

[ -f "$vsix" ] || { echo "错误: 找不到 vsix: $vsix" >&2; exit 1; }
actual=$(unzip -p "$vsix" '*/package.json' | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version")
[ "$actual" = "$expect" ] || { echo "错误: vsix 内版本 $actual != 期望 $expect" >&2; exit 1; }
list=$(unzip -l "$vsix")
for f in 'dist/extension.js' 'package.json' 'readme' 'license'; do
  echo "$list" | grep -qi "$f" || { echo "错误: vsix 缺少 $f" >&2; exit 1; }
done
echo "$list" | grep -q 'assets/' || { echo "错误: vsix 缺少 assets/" >&2; exit 1; }
for bad in ' src/' ' test/' ' docs/' ' scripts/' '.agents/' 'AGENTS.md' '.map' 'node_modules/'; do
  echo "$list" | grep -q "$bad" && { echo "错误: vsix 不应包含 $bad" >&2; exit 1; }
done
echo "$list" | grep -Eq '\.ts([[:space:]]|$)' && { echo "错误: vsix 不应包含 .ts 文件" >&2; exit 1; }
echo "vsix 内容与版本校验通过（version=${actual}）"

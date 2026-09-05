#!/usr/bin/env bash
# 用法: scripts/ui-visual-diff.sh <before-dir> <after-dir>
# 布局/全局样式改动的分诊工具：对两套 ui-visual.sh 截图做像素 diff，按变化幅度
# 排序列出「哪些场景变了」——改动号称只影响 X 但清单冒出 Y，就是漏网信号。
# 注意：本脚本只负责分诊（哪变了），判定对错仍靠读截图 + 场景 expect 的语义核对
# （见 .agents/skills/ai-visual-validation/SKILL.md「视觉验证方法」第 8 条）。
# 依赖：python3 + pillow（缺则提示安装）。
set -euo pipefail

BEFORE="${1:?用法: ui-visual-diff.sh <before-dir> <after-dir>}"
AFTER="${2:?缺少 after-dir}"

python3 - "$BEFORE" "$AFTER" <<'EOF'
import os, sys
try:
    from PIL import Image, ImageChops
except ImportError:
    sys.exit("缺 pillow：python3 -m pip install --user pillow 后重试（或自建 venv）")
A, B = sys.argv[1], sys.argv[2]
rows = []
for f in sorted(os.listdir(A)):
    if not f.endswith(".png"):
        continue
    pa, pb = os.path.join(A, f), os.path.join(B, f)
    if not os.path.exists(pb):
        rows.append((f, "新版缺截图"))
        continue
    ia, ib = Image.open(pa).convert("RGB"), Image.open(pb).convert("RGB")
    if ia.size != ib.size:
        rows.append((f, "尺寸不同"))
        continue
    diff = ImageChops.difference(ia, ib)
    h = diff.convert("L").point(lambda v: 255 if v > 16 else 0).histogram()
    rows.append((f, h[255] / (ia.size[0] * ia.size[1])))
same = [r for r in rows if r[1] == 0]
changed = [r for r in rows if r[1] != 0]
print(f"共 {len(rows)} 对；完全一致 {len(same)}；有差异 {len(changed)}")
for f, r in sorted(changed, key=lambda x: -(x[1] if isinstance(x[1], float) else 1)):
    print(f"  {f}: {r*100:.2f}% 像素变化" if isinstance(r, float) else f"  {f}: {r}")
EOF

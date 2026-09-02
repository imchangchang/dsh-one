# development.md 里 publisher 占位那句过时

记录于 2026-09-01。来自发布流程讨论：文档里一句与现状不符。

## 背景与现象

`docs/development.md` 的「发版流程」第 1 步还写着 `"publisher": "dsh-one"` 是占位、发布前必须改成你在 marketplace 的 publisher ID。

## 现状

- `package.json` 的 publisher 已是 **`cgeng`**（2026-08-31 完成，见 `marketplace-publish.md`），不再是 `dsh-one` 占位。
- 这句会误导：让人以为还要改 publisher，实际账号已定。

## 方案

把该句改成「确认 publisher 是你要发布的账号（现为 `cgeng`）」，或直接删掉占位说明，避免发布时误改 publisher ID。

## 涉及代码位置

- `docs/development.md`（发版流程第一节）

- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过（typecheck + test + build 全绿）→ done

## 开发完成

- 改动：`docs/development.md` 发版流程第 1 步由「改 publisher：`dsh-one` 是占位、发布前必须改成你的 publisher ID」改为「确认 publisher：`"publisher"` 应是你要发布的 marketplace 账号（现为 `cgeng`），发布前确认即可，无需修改」。`package.json` 的 publisher 已是 `cgeng`（2026-08-31 定下）。
- 人工验收方法：纯文档改动，无 UI。验收 = 在合并后的主线执行 `grep -n "publisher" docs/development.md`，发版流程第 1 步不再出现 `dsh-one` 占位或「必须改成你的 publisher ID」的说法，而是「确认 publisher…现为 `cgeng`」。可顺带 `grep -n '"publisher"' package.json` 确认值为 `cgeng`。
- 2026-09-01 主线合入（merge commit `1cedd31`），复测全绿，grep 验收通过 → closed

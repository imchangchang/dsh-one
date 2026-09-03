# @ token 解析边界：ASCII 标点/括号/词中匹配的完整性

## 背景与现象

评审实测（userBubble.ts PLAIN_TOKEN_PATTERN / fileReference.ts activeAtToken / sessionMention.ts expand）：
- `@a.txt.后面`、`@a.txt,后面`、`@a.txt😀 后面` → ASCII 标点/emoji 不终止，正文被吞进 chip（既有问题，分支只修复了全角标点）
- `（@img1 和 @img2）` → `（` 后不触发、`@img2）` 闭括号被吞（开括号既非边界也非终止，两头错）
- `a@img b`（词中/邮箱形态）→ expand/highlight/indexOf 裸子串匹配会替换，而渲染侧不识别——输入与渲染不一致
- `@a（说明）` 中文件名含 `（注释）`：已修复（括号不终止）；文件名含 `，！？` 仍会被截断（字符集无法两全，已知取舍）
- shouldFoldPastText CRLF 正确（已测）

## 方案（待确认）

1. 统一 token 区间扫描纯函数（含边界字符集），输入侧（expand/highlight/导航/删除）与渲染侧共用
2. 边界集补常用开括号（（「『《〔【）；终止集补 ASCII 标点（需条件规则：`.`/`,` 仅后跟空白/行尾才终止，避免文件名 `a.txt` 被拦断）
3. 展开/高亮前 token 边界校验（独立词出现）
4. 注释写明「文件名含中文句读标点会截断」的取舍

## 变更记录

- 2026-09-08 代码评审确认后建条目 → open

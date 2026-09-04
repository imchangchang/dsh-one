# @ token 解析边界：ASCII 标点/括号/词中匹配的完整性

## 背景与现象

评审实测（userBubble.ts PLAIN_TOKEN_PATTERN / fileReference.ts activeAtToken / sessionMention.ts expand）：
- `@a.txt.后面`、`@a.txt,后面`、`@a.txt😀 后面` → ASCII 标点/emoji 不终止，正文被吞进 chip（既有问题，分支只修复了全角标点）
- `（@img1 和 @img2）` → `（` 后不触发、`@img2）` 闭括号被吞（开括号既非边界也非终止，两头错）
- `a@img b`（词中/邮箱形态）→ expand/highlight/indexOf 裸子串匹配会替换，而渲染侧不识别——输入与渲染不一致
- `@a（说明）` 中文件名含 `（注释）`：已修复（括号不终止）；文件名含 `，！？` 仍会被截断（字符集无法两全，已知取舍）
- shouldFoldPastText CRLF 正确（已测）

## 方案（已拍板 2026-09-04）

1. **统一 @token 区间扫描纯函数**（逐字符状态机：边界判定 + 终止规则 + quoted 分支），放 `src/pure/` 独立模块；产出「@ 触发点 + token 区间」。渲染侧（`splitUserBubble`）直接消费区间；输入侧（ref-token-layer 高亮 / arrowNavPosition / tokenDeletion / expandMentionBindings / restoreFileMentionTokens）在扫描起点处按 mentionBindings 做 key 最长匹配——兼容含空格显示 token（`@with space.txt`），`a@img b` 词中命中自然排除，无需另写 indexOf 扫描。`activeAtToken`（补全触发）用同一套边界/终止规则；quoted 分支保留官方语义（仅未闭合引号算 quoted，闭合引号回落 plain，与现有测试一致）。
2. **边界集**（@ 前一字符）：行首 + `[\s，。；：！？、,;!?]` + 中文开括号 `（「『《〔【`（ASCII `(` 不加，避免代码/装饰器 `func(@arg)`、`@Component(` 新增误渲染）。
3. **终止规则**（plain token 逐字符）：
   - 无条件终止：空白、中文/全角标点（现状全集 `\u3000-\u303f` + `，！？；：．･`）、`\p{So}`（emoji/符号，修 `@a.txt😀`）、ASCII `; ! ? :`（新增，修 `@img1: 说明`、`@a; 看`）
   - 条件终止：`.`/`,` 仅后跟非续接字符（续接 = `[A-Za-z0-9/_~-]`）时终止——修 `@a.txt.后面`、`@a.txt,后面`，`a.txt`/`a.b.c`/`(1).jpg` 不受影响
   - 平衡规则：`)`/`）` 终止，除非 token 内已有配对开括号 `(`/`（`——修 `@img2）`，`@a（说明）.docx` 不受影响
   - 其余 ASCII 标点（`' # & + % $ = @ * < > | "`）保持 token 字符，不在本条范围
4. **已知取舍**（代码注释写明）：文件名含中文句读标点（现状）、ASCII `;!?:`、emoji/`\p{So}` 会被截断；TRAILING_PUNCTUATION 剥离逻辑可删除（终止集已覆盖）。
5. **与 mention-bindings-lifecycle 衔接**：本条目先行，mention-bindings 排后（其「展开前边界校验」复用本条的扫描起点校验，不另写一套；建议给该条目补「前置：paste-token-parsing-boundaries」）。

### 验收案例（实现与测试对照）

| 输入 | 期望 |
| --- | --- |
| `@a.txt.后面` / `@a.txt,后面` | chip `a.txt`，标点留在文本 |
| `@a.txt😀 后面` | chip `a.txt`，emoji 留在文本 |
| `（@img1 和 @img2）` | 两个 chip，括号留在文本 |
| `a@img b` | 不替换 / 不高亮 / 不渲染 chip |
| `@a（说明）.docx` | 完整 chip |
| `@src/index.ts` / `@a(1).jpg` | 完整 chip |
| 邮箱 `a@b.com` | 不触发 |
| `看@img` | 不触发（汉字紧邻，词中） |

## 变更记录

- 2026-09-04 方案细节与主 session 拍板：平衡规则、`.`/`,` 条件规则、`\p{So}` 入终止集、ASCII `(` 不入边界、ASCII `;!?:` 入终止集、本条目先于 mention-bindings → open（可开工）
- 2026-09-08 代码评审确认后建条目 → open

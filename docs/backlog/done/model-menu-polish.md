# 模型选择器差异：菜单内容与 trigger 形态（局部缺失）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现；2026-09-01 评审标注「待定（用户：再核实一下）」，已核实，结论如下。

## 现状（已核实 2026-09-01）

dsh web 模型选择（`dsh-client-ui-model-selection`，lib/client.js:438-621）：模型/推理等级两级菜单、按 provider 分组带描述、loading/error/Retry 态；trigger 含推理等级后缀；模型不可用时输入区有专门阻塞文案。

dsh-one 核对结果：

- ✅ **已对齐**：trigger 显示「模型名 + 推理等级名」（`src/server/chatSession.ts` `modelLabelOf` :100-114，web 风格 "DeepSeek-V4-Flash-Vision-Exp Max"）；两级菜单结构（模型/推理等级）一致。
- ❌ **仍缺**：模型列表无描述（`renderModelMenuModels` webview.ts:1154-1180 只有分组名 + 模型名 + 勾选）；菜单无 loading/error/**Retry 行**（openModelMenu :1117-1128 只有「加载中…」hint）；模型不可用时无「当前模型不可用，请先选择模型」式阻塞文案（置灰时 placeholder 是「服务未就绪，暂时无法发送」）。

## 涉及代码位置

- dsh web：`dsh-client-ui-model-selection`
- dsh-one：`src/ui/chat/webview.ts`（renderModelMenuRoot / renderModelMenuModels / openModelMenu / renderInput 的 model pill）、`src/server/chatSession.ts`（modelLabelOf，已对齐部分）

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审：待定（用户标注「就是这个样子，再核实一下」）；已核实 trigger 对齐、菜单描述/Retry/阻塞文案仍缺，待用户拍板是否补齐

- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过（typecheck + 253 test + build）→ done

## 开发完成（2026-09-01，commit a7a263a）

三项补齐（用户拍板：三项全做；error/Retry 用「无旧目录 error+Retry、有旧目录保留旧数据」；模型不可用判定用 `session.models` 的 `routable`；去掉全局 toast 只留菜单内错误）：

- ① 模型列表描述：`menuItem` 加 `sub` 选项（名称 + 描述两行，新增 `.menu-item.has-desc` / `.menu-item-main` / `.menu-item-desc` 样式），`renderModelMenuModels` 传 `m.description`（数据链路原有，未动）。
- ② loading/error/Retry：`sendModelCatalog`（chatView.ts）失败不再 `showErrorMessage`，改发新消息 `modelCatalogError`；webview 无旧目录时菜单显示「模型列表加载失败」+「重试」行（重试重发 `requestModels`），有旧目录保留旧数据不打断；`openModelMenu` 打开时重置失败标志。
- ③ 模型不可用阻塞文案：`ChatState` 加 `modelAvailable`（chatSession 存 `session.models.routable`，拉取失败保持 true 不误报）；false 时输入框 disabled + placeholder「当前模型不可用，请先选择模型」，发送按钮同样禁用，模型 pill 保持可点以便重选。

### 人工验收方法（dev-ui-test，命令见 worktree-dev-flow skill）

正常态：开 chat 面板 → 点输入区下方模型 pill → 菜单「模型」二级列表每行显示模型名 + 描述小字（如 DeepSeek-V4-Flash-Vision-Exp），当前模型有 ✓。

断网/停 dsh 服务后：点模型 pill → 若从未拿到过目录，菜单显示「模型列表加载失败」+「重试」；点「重试」先显示「加载中…」再回到失败行；若菜单打开前已有旧目录，失败时菜单仍显示旧目录（不打断）。不再弹 VSCode 全局错误 toast。

删模型目录（令 session.models 返回 routable=false）：输入区 placeholder 变「当前模型不可用，请先选择模型」，输入框与发送按钮禁用，但模型 pill 仍可点；从菜单重选可用模型后输入区恢复。

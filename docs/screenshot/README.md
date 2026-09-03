# 截图清单

`en/` 英文界面截图，`zh-CN/` 中文界面截图。命名 = 场景名，两语言同名文件内容对应。

## 市场可用性结论

- VS Code Marketplace 不强制要截图，截图靠 README 展示；`package.json` 已配 `repository`，README 里相对路径引图在市场页能正常渲染。
- **README 只放整窗口截图**（用户要求 2026-09-03）：局部裁切图（context-usage、status-bar-menu 弹层/状态栏特写）不进 README，留作宣发配图素材。
- 截图露出本机路径（`C:\Users\imcha\...`）可接受（用户确认 2026-09-03）：真实截图本来就会有路径，不作为对外使用的排除项。
- 已进 README：英文 6 张（new-session-hero、install-guide、chat-first-reply、plan-review、ask-user-question、permission-request）；中文 4 张（new-session-hero、install-guide、session-context-menu、new-session-status-menu）。

## 现有截图台账

### en/

| 文件 | 内容 | 进 README | 备注 |
| --- | --- | --- | --- |
| `install-guide.jpeg` | dsh 未安装空态：安装指南按钮 + Windows 一键脚本 | ✅ | — |
| `service-starting.jpeg` | 服务启动中提示 | ❌ | 过渡态，信息量少，留档即可 |
| `new-session-hero.jpeg` | 新会话空态：鲸鱼 logo + 输入区（模型/权限模式选择器） | ✅ | 侧栏分组名是 `test`/`Ungrouped`，略随意但可接受 |
| `chat-first-reply.jpeg` | 首轮回复：markdown 列表 + 消息操作 + 耗时统计 | ✅ | — |
| `ask-user-question.jpeg` | ask_user_question 提问卡（选项 + Submit） | ✅ | 会话名全是 test sessionX |
| `plan-review.jpeg` | plan review 卡（Approve / Keep planning / Reply in chat） | ✅ | 计划正文是测试内容（nesting-test） |
| `context-usage.jpeg` | 上下文用量弹层（1% used，分项 + 剩余轮数预估） | ❌ | 局部裁切图，不进 README；可作宣发配图 |
| `permission-request.jpeg` | 权限请求卡（Allow once / Reject）+ 写越界 diff | ✅ | — |
| `status-bar-menu.jpeg` | 状态栏悬停卡（Open in Browser / Restart / Stop / Logs） | ❌ | 局部裁切图，不进 README；可作宣发配图 |

### zh-CN/

| 文件 | 内容 | 进 README | 备注 |
| --- | --- | --- | --- |
| `install-guide.jpeg` | 未检测到 dsh 空态 + 一键脚本 | ✅ | — |
| `service-starting.jpeg` | 正在启动 dsh 服务 | ❌ | 过渡态，留档 |
| `new-session-hero.jpeg` | 新会话空态（标准模式、workspace chip、vscode 角标） | ✅ | — |
| `new-session-status-menu.jpeg` | 空态 + 状态栏悬停卡同框 | ✅ | 与 `new-session-hero` 近似，但补上了状态栏场景 |
| `status-bar-menu.jpeg` | 状态栏悬停卡（在浏览器中打开/重启/停止/日志） | ❌ | 局部裁切图，不进 README；可作宣发配图 |
| `subagent-tree.jpeg` | 子代理树下拉（3 层嵌套 + 后台 job 列表） | ❌ | 裁切图，背景文字边缘被切断，正式用需重拍全窗口 |
| `session-context-menu.jpeg` | 会话右键菜单（置顶/未读/重命名/分叉/归档等） | ✅ | 与树下拉同框，画面略杂 |
| `context-usage.jpeg` | 上下文用量弹层（已用 2%） | ❌ | 局部裁切图，不进 README；可作宣发配图 |

## 已有截图的共性问题

1. 会话名、对话内容都是测试残留（test sessionX、nesting-test），市场 README 里可接受，宣发物料应换真实演示内容。
2. 全部 Windows + 深色主题；jpeg 有压缩痕迹，UI 截图建议用 PNG。
3. 中文版缺功能整窗图：plan review、ask_user_question、权限请求、使用中对话都只有英文版（中文版 README 暂时用右键菜单和状态栏图顶上）。

## 缺失截图（对照 README 功能列表）

宣发或补 README 时按这张表拍，优先级从高到低：

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| dsh web 编辑器标签页（iframe 完整 UI） | ❌ 两语言都缺 | 「桥接」定位的主证据图 |
| 聊天面板使用中（中文） | ❌ 缺 | en 有 `chat-first-reply`，中文没有 |
| plan review / ask_user_question / 权限请求（中文） | ❌ 缺 | 都只有英文版 |
| 右键「发送到当前会话」+ 附件 chip/缩略图 | ❌ 两语言都缺 | 编辑器/资源管理器右键 + 输入区暂存效果 |
| 运行中一键停止 | ❌ 缺 | 配合流式输出状态拍 |
| 子代理运行（整窗口） | ⚠️ zh 有裁切图 | en 缺；正式版拍全窗口 |
| todo 清单卡片 | ❌ 缺 | |
| 模型/权限模式/agent preset 选择器展开态 | ❌ 缺 | 空态里只露了收起态 |
| 后台任务（background jobs）面板 | ❌ 缺 | zh 树下拉里带到一点，不算 |
| 会话搜索/排序 | ❌ 缺 | 列表上有搜索框，但没有使用中的图 |
| 状态栏各状态（启动中/错误/未安装） | ⚠️ 部分 | `service-starting` 留档；错误态缺 |

## 宣发补拍提示

- 首用全流程连拍（干净环境：装插件 → 空态引导 → 一键脚本 → 装完 → 第一条消息）是转化链路的证据组图，优先拍。
- 重拍统一：干净演示目录 + 有意义的会话名 + PNG + 中英文各一份；先拍上面「缺失截图」表里的高优先项。

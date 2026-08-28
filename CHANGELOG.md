# Change Log

## [Unreleased]

### Changed

- Sessions 树视图合并进 Chat 面板（原生 tree view 移除）：宽屏（≥720px）为左右两栏（左会话列表 260px、右聊天），窄屏改上下布局（会话列表在上、限高 40% 自滚动）。搜索框、排序切换、刷新、新建 workspace/会话、重命名/归档、打开文件夹等操作全部移至面板内；服务未运行/未安装 dsh 的空态与启动、安装引导按钮也随之迁入面板。

### Added

- 初始版本：运行时按需下载（Node + dsh）、dsh web 服务管理（探测/复用/spawn/清理）、侧边栏与编辑器标签页内嵌官方 UI、状态栏、自动更新。
- Sessions 侧边栏支持按标题/会话 ID 搜索过滤，以及排序切换（最近更新优先 / 最早更新优先 / 按标题），排序偏好持久化。
- 对话消息级操作：助手消息下方可复制全文、标记有用/没用（对接主机 messageFeedback）、从已完成轮次创建分支会话；操作行与 dsh web 端图标风格对齐。
- Sessions 视图：标题栏 + 号改为新建 workspace（选择文件夹注册到 dsh）；新建会话的 + 移到每个 workspace 行的内联按钮。
- 未安装 dsh 时，Sessions 欢迎页与 Chat 空态显示安装引导，一键打开官方安装页面（deepseek.com/harness）。

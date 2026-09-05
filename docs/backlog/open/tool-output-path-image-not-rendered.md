# 工具输出里的本地路径图片不显示（read_image 等）

## 背景与现象

用户在「开发主线大管家」会话截图检查界面：`Read read_image` 工具调用后看不到图片。视觉验证（harness 场景 + headless Chromium）对照确认：

- **`data:image/png;base64` 的 markdown 图片：正常渲染**（DOMPurify 默认放行 img 的 data:image，无问题）。
- **本地路径图片**（`![img](/Users/…/x.png)`、`file://` 等）：`<img>` 加载失败 → 残缺小图标 + 文件名，图片不显示。
- dsh 的 `read_image` 工具输出正是**文件路径形式**（工具把读到的图片以路径写进 markdown），所以插件里工具画出的图全部缺失。早前附件（文件方式）用 `messageImageThumb`/`fileThumb` 通道渲染是**另一条路径**（host 侧取字节），markdown 内嵌路径图没有对应通道。

## 方案候选（未定）

1. **host 侧图片通道**：渲染 markdown 时识别**本地路径图片 src** → 发给 host（`fileThumb`/`requestAttachment` 类似机制）→ host 读文件（限大小/图像类型）→ 返回 data URL → 渲染。与现有附件缩略图通道同构，复用字节缓存。
2. **路径转 attachment 引用**：dsh session 里图片若是 attachment（attachmentId），走已有 `messageImageThumb`；路径形式单独处理。
3. 保守（先修交互）：broken img 显示更明确的占位（如「点击在外部打开」+ 打开编辑器），不强行渲染。

## 涉及代码位置（待核实）

- `src/ui/chat/webview.ts`：markdown 渲染（`md()` + 图片装饰）、附件缩略图通道（`messageImageThumb`/`fileThumb`/`attachmentCache`）
- 宿主侧：fileThumb 处理（已有，文件附件缩略图）

## 变更记录

- 2026-09-05 用户界面检查（Read read_image 后图片缺失）→ 视觉验证（harness 场景 data-URI vs 路径对照）→ 确认：路径图片不显示、data-URI 正常 → 建条目（open/）

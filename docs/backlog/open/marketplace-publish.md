# 发布到 VS Code Marketplace

记录于 2026-08-31。目标：本周内把 dsh-one 发布到 VS Code 插件市场（个人开发者身份）。

## 现状

账号侧已完成/进行中：

- Azure DevOps 组织已创建：`https://dev.azure.com/C3NG`（区域 Asia Pacific）。期间踩坑：新账号建组织强制要求先关联 Azure 订阅（页面不报错、Continue 直接失效），注册免费订阅后才放行。
- PAT 创建中（用户手动）：名称 `vscode-marketplace`，范围 **All accessible organizations**，权限只勾 **Marketplace → Manage**。
- publisher ID 定为 **`cgeng`**（用户拍板，将显示在插件页 URL）。
- verified publisher 蓝标暂不可做：官方要求插件在市场上满 6 个月且域名注册满 6 个月，半年后再议。

## 待做（工程侧）

1. ~~`package.json` 的 `publisher` 改为 `cgeng`~~（已完成，2026-08-31）。
2. ~~补市场图标~~（已完成，2026-08-31）：最终采用 Recraft 生成的像素鲸鱼稿，按像素提取鲸鱼形状、规范为 `#2563EB`、裁剪居中，导出 512×512 透明底 `assets/icon.png`，package.json 已加 `"icon"`。注意：Recraft 的"透明背景"是画上去的棋盘格（灰块掩在蓝底上露出鲸鱼），必须按像素后处理，不能直接用。
3. ~~试打包~~（已完成：`vsce package` 零报错零警告，vsix 不含 node_modules；顺手把内部文档 `docs/**` 加进 `.vscodeignore`，包内只剩 LICENSE/changelog/readme/assets/dist）。
4. ~~GitHub 仓库 public + 代码推送~~（已完成 2026-08-31：main 已推送 27 个提交到 origin，`assets/icon.png`/`icon.svg` 经 raw.githubusercontent.com 验证可访问；README 无内嵌图片，无裂图风险）。

## 待做（账号侧，需用户本人）

5. ~~到 [marketplace 管理页](https://marketplace.visualstudio.com/manage) 创建 publisher~~（已完成 2026-08-31，ID `cgeng`）。
6. `vsce login cgeng`（粘贴 PAT）→ `vsce publish` 首发。
7. 发布后干净环境安装验证一遍。

## 备注

- PAT 只显示一次，用户自行保存；不要入库、不要进 git。
- 浏览器自动化通道已就绪：kimi-webbridge 已装为 dsh 全局 skill（`~/.dsh/skills/kimi-webbridge`），后续发布操作可代点。
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-02 构建链路已改：**上市场的 vsix 来自 GitHub Release**（tag push → release.yml 构建挂产物 → 验收该产物后 `vsce publish`，本地不打包）。首发流程改为：`git push origin main`（release.yml 生效）→ release-gate bump 1.0.0 + tag → push tag → 下载 Release 产物验收 → `npx vsce publish dsh-one-1.0.0.vsix`。详见 release-gate skill 与 docs/release-checklist.md。

- 2026-09-03：v1.0.0 已走 release-gate 发布——tag v1.0.0（commit 607e508）→ release.yml 构建 → GitHub Release 挂 dsh-one-1.0.0.vsix；独立验收代理重验通过（sha256 与 Release 一致、vsix 内容/版本合规）。剩：人工 GUI 沙盒装机验收 → vsce login cgeng → npx vsce publish <Release 下载的 vsix>（用 /tmp/dsh-relcheck/dsh-one-1.0.0.vsix 那份，不重打包）。
- 2026-09-03 修正：`vsce publish` 的位置参数是版本号不是文件路径，发布已有 vsix 的正确写法是 `npx vsce publish --packagePath <vsix>`（首发 1.0.0 时踩到，报 Invalid version）。文档与 release-gate.sh 提示已统一修正。

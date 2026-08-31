# 发布到 VS Code Marketplace

记录于 2026-08-31。目标：本周内把 dsh-one 发布到 VS Code 插件市场（个人开发者身份）。

## 现状

账号侧已完成/进行中：

- Azure DevOps 组织已创建：`https://dev.azure.com/C3NG`（区域 Asia Pacific）。期间踩坑：新账号建组织强制要求先关联 Azure 订阅（页面不报错、Continue 直接失效），注册免费订阅后才放行。
- PAT 创建中（用户手动）：名称 `vscode-marketplace`，范围 **All accessible organizations**，权限只勾 **Marketplace → Manage**。
- publisher ID 定为 **`cgeng`**（用户拍板，将显示在插件页 URL）。
- verified publisher 蓝标暂不可做：官方要求插件在市场上满 6 个月且域名注册满 6 个月，半年后再议。

## 待做（工程侧）

1. ~~`package.json` 的 `publisher` 改为 `cgeng`~~（已完成，2026-10-29）。
2. ~~补市场图标~~（已完成：无头 Chrome 把 `assets/icon.svg` 截成 256×256 `assets/icon.png`，package.json 加 `"icon"`）。
3. ~~试打包~~（已完成：`vsce package` 零报错零警告，vsix 不含 node_modules；顺手把内部文档 `docs/**` 加进 `.vscodeignore`，包内只剩 LICENSE/changelog/readme/assets/dist）。
4. GitHub 仓库 `imchangchang/dsh-one` 已确认 **public**（gh 实测）；代码推送待做——本地 main 领先 origin/main 21 个提交，发布前需推送（README 相对路径图片依赖它解析）。

## 待做（账号侧，需用户本人）

5. 到 [marketplace 管理页](https://marketplace.visualstudio.com/manage) 创建 publisher，ID 填 `cgeng`。
6. `vsce login cgeng`（粘贴 PAT）→ `vsce publish` 首发。
7. 发布后干净环境安装验证一遍。

## 备注

- PAT 只显示一次，用户自行保存；不要入库、不要进 git。
- 浏览器自动化通道已就绪：kimi-webbridge 已装为 dsh 全局 skill（`~/.dsh/skills/kimi-webbridge`），后续发布操作可代点。

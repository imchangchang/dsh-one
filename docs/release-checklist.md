# 发布验收清单（release checklist）

发布 = `scripts/release-gate.sh --apply` 收口（version + CHANGELOG + 打 tag）并 push tag、GitHub Actions（`.github/workflows/release.yml`）构建出 **GitHub Release 产物**之后、`vsce publish` 之前的人工验收。

**验收对象 = GitHub Release 上的 `dsh-one-<版本>.vsix`，从 Releases 页下载，不本地打包**——本地打的包没有过门禁校验，版本/内容都可能对不上。

预发布（版本带 `-rc.N`）与正式版同一套验收：rc 产物在 GitHub Release 标 **prerelease**（内测用，CHANGELOG [Unreleased] 未消费），**验收通过后发同核心正式版再收口**，此时正式版产物还需再验一遍再上市场——rc 验收通过 ≠ 正式版免验（版本号/内容都变了）。

```bash
# 下载约定的 Release 产物（gh 已装可直接用；或在 GitHub Releases 页手动下载）
gh release download v<版本> --repo imchangchang/dsh-one --pattern "dsh-one-<版本>.vsix" --dir /tmp/dsh-relcheck/
# 抽验产物内容与版本（可选，门禁已验）
scripts/verify-vsix.sh /tmp/dsh-relcheck/dsh-one-<版本>.vsix <版本>
```

## 沙盒装机验收

在隔离的 VSCode 实例（独立 user-data-dir，不碰日常配置）里安装 **Release 下载的 vsix** 验收：

```bash
# <版本> 换成 release-gate 锁定的版本
code --user-data-dir /tmp/dsh-relcheck/ --install-extension "/tmp/dsh-relcheck/dsh-one-<版本>.vsix"
code --user-data-dir /tmp/dsh-relcheck/ .
```

- [ ] 未安装 dsh 的环境（PATH 摘掉 dsh，或 `dshOne.dshPath` 指向不存在的路径）：打开面板报「未找到 dsh」并引导安装，无其他异常。
- [ ] 装好 dsh 后打开面板：定位 dsh → 启动服务 → iframe 加载出官方 UI，全链路无报错。
- [ ] 状态栏四态（运行中/启动中/已停止/错误）显示正确；复用已有实例时 tooltip 有提示。
- [ ] 先手动 `dsh web --port 3080` 起实例再开面板：确认复用该实例且不 kill（0.1.1 无认证实例路径）。
- [ ] 终端手动 `dsh web --port 3080`（0.1.2+ 认证实例）后开面板：默认**不**另起实例（状态栏错误 + tooltip 说明）；tooltip「粘贴启动 Token」→ 粘贴终端 URL 的 `?token=` → 可连接浏览；tooltip「停止外部实例」弹确认 → 杀单 pid（`ps` 对照命令行含 dsh）→ 实例优雅退出；「重启服务」后新实例归扩展管理（此后免确认）。**注意**：手动 `dsh web` 起的就是外部实例，测完把实例停掉，避免后续扩展启动一直走防护分支。
- [ ] Windows（用户机器实测，补进本清单）：外部实例停止/重启（`taskkill /T /F`，无优雅路径）与 token 粘贴流程。
- [ ] 关闭 VSCode 后确认 spawn 的 dsh 进程被回收（`ps` / 任务管理器），复用的实例不受影响。
- [ ] 命令各点一次：`DSH One: 打开面板` / `在编辑器标签页打开` / `重启服务` / `停止服务` / `显示日志`。
- [ ] 基本可用性抽查：新建会话 → 发送一条消息 → 收到回复（会话列表与聊天面板正常）。
- [ ] Windows 和 macOS 至少各过一遍上面的流程（spawn/杀进程路径分平台）。

## README 与版本确认

- [ ] README 的功能描述、截图与本次发布内容一致（无已失效的描述）。
- [ ] 上传到 marketplace 的 vsix 就是 **GitHub Release 下载的那份**（不重打包、不改文件）。
- [ ] 插件页显示的版本号 == Release 产物版本（发布后在 marketplace 页面确认）。
- [ ] release.yml 构建通过，`git tag v<版本>` 指向的 commit == 构建 commit（tag 即构建触发点，`git log v<版本> -1` 抽查）。

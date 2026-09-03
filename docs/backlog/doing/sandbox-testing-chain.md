# Docker 沙盒测试/截图环境（spike 已验证，待产品化）

## 背景与现状

宣发截图（中英文）和最终状态验证需要在真 VS Code 里跑插件。2026-09-03 spike 已验证完整链路可行：

- OrbStack 容器跑 code-server（官方镜像 + 拷入 node 24 + npm 全局装 dsh@0.1.1-rc.2 + 预装 vsix）
- 宿主 `~/.dsh` 只读挂载进容器后复制（容器可写、不污染宿主），真 dsh 可直接调通模型
- 预置用户设置关 workspace trust（`security.workspace.trust.enabled: false`）
- 用 Kimi WebBridge 接管：navigate/click/evaluate/screenshot 全可用；code-server 里 webview 是同源嵌套 iframe，evaluate 递归 `contentDocument` 可进；发消息要点 `.send-button`（合成 Enter keydown 无效）
- 产出在 /tmp/dsh-sandbox（Dockerfile + entrypoint.sh + vsix + 截图），未进仓库

协议面已摸清（mock 用）：RPC 信封 POST `/api/<method>`（`{type:'client-request',rpcId,method,payload}`，回包 echo rpcId）、WS `/api/events.host` + `/api/events.mux`、POST `/api/respond` 应答 server-request。manager 会先探测端口、已有 dsh 直接接管——mock 只需先占端口。

## 建议方案（已确认的方向）

1. **脚本化进仓库**：Dockerfile/entrypoint/起停脚本入 `test/sandbox/`，一条命令起沙盒。
2. **mock dsh**：Node HTTP+WS server 实现上述协议面，场景文件编排会话/消息/审批/流式/错误态（边界条件：API 报错、特定文案、超时等真 dsh 喂不出来的）。先占端口让扩展 adopt。
3. **双语截图**：code-server 写 argv.json `locale: zh-cn` / `en` 各跑一遍，mock 喂固定数据保证确定性。
4. **验证方法**：截图 + expect 语义核对（沿用 ai-visual-validation skill 的方法）；回归自动化后续可加 CDP（WebBridge 的 `cdp` 通道已验证可发 trusted 键盘事件）。
5. 档 B（容器跑真桌面版 VS Code + noVNC）留作保真度不够时的升级，暂不做。

前置：dsh-next-token-auth-incompatible（若容器要装 dsh@next 需先解决认证；目前 pin 0.1.1-rc.2 绕过）

## 涉及代码位置

- 新增 `test/sandbox/`（Dockerfile、entrypoint、起停脚本、mock dsh server、场景文件）
- `src/server/manager.ts` 的 probe/adopt 逻辑是 mock 的对接点
- `src/pure/hostFrames.ts`、`src/pure/chatContract.ts` 是帧/状态格式的现成参照

## 变更记录

- 2026-09-03 spike 验证通过后记录进 open/，方案已经 session 内确认。

- 2026-09-03 认领开发（open → doing）：docker 沙盒脚本化 + mock dsh server。

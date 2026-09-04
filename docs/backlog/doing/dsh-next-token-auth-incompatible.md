# dsh@next（0.1.2-rc.1）/api/* 新增 token 认证，扩展无法工作

## 背景与现象

2026-09-03 在 Docker 沙盒（code-server + 容器内 dsh）里装 `@deepseek-ai/dsh@next`（0.1.2-rc.1）时，扩展状态栏报「Service Error」，90 秒启动超时。扩展日志显示 probe 全部失败：

```
probe: http://127.0.0.1:3080/api/host.describe responded but failed rpcId validation (foreign service)
failed to start dsh: dsh startup timed out (90s)
```

## 根因

dsh 0.1.2-rc.1 起 web 服务时打印的 URL 带 `?token=***`，且 `/api/host.describe` 不带凭证直接回 401 `unauthorized`（`?token=` query 参数也不认）。扩展侧 `src/server/manager.ts` 的 `probePort` 和 `src/server/dshRpc.ts` 的所有 RPC 调用都不带任何认证信息——整个扩展没有 token 概念。宿主本机跑的 0.1.1-rc.2 无此要求，所以日常使用不暴露。

影响：用户一旦把 dsh 升到 0.1.2（或扩展新用户按引导装了 @next），扩展必然起不来。

## 认证模型（2026-09-04 从 0.1.2-rc.1 源码核实，dsh-client-connection）

0.1.2 的机制是「启动 token 换签名 cookie」，**token 不能直接调 API**：

1. 进程每次启动生成随机 launch token（32B base64url，WeakMap 挂进程），`authenticatedUrl()` 把它加到根 URL 的 `?token=`。
2. 带 token 访问 `GET /`（tokenMatches 恒时比较）→ 服务端签一个 session cookie（HMAC-SHA256、HttpOnly、SameSite=Strict、绑定请求 Host 的 authority、maxAgeDays 过期）→ 303 重定向到干净 `/`。
3. 之后所有 `/api/*`（POST RPC）与 WS 连接都走 `isAuthenticated`（校验 cookie），无 cookie 一律 401 `unauthorized`。
4. `isTrustedApiRequest`（Host fence：loopback/trustedHosts + origin 同源检查）只是防 DNS rebinding/CSRF，源码注释明确 **"this fence is not an auth layer"**——本机 loopback 请求**不免认证**。

（此前条目写的「`?token=` query 参数也不认」就是指 token 不能直接带 API；「本机免认证」方向不存在，已否决。）

## 方案（已拍板 2026-09-04：官方标准路径）

1. 扩展 spawn dsh 后从 stdout 解析带 `?token=` 的 URL → 对 `/` 发 `GET ?token=` 换 cookie（记住 authority = `127.0.0.1:<port>`）→ 后续所有 RPC（`src/server/dshRpc.ts`）/ WS（hostEvents/muxEvents）/ probe 请求带 cookie。
2. 0.1.1 无认证（无 401），直接兼容：实现不破坏 0.1.1 路径即可。
3. **实施时需验证的坑**：扩展 reload 时 dsh 进程仍在、stdout 已丢的 token 获取路径（可能需在 profile 目录存一份或复用已建连接）；cookie `maxAgeDays` 默认值与配置来源。
4. 不做：与 dsh 约定免认证（上游不可控）；pin 版本（只当文档性缓解，不阻塞）。

## 涉及代码位置

## 涉及代码位置

- `src/server/manager.ts`（probePort / waitReady / spawn 输出解析）
- `src/pure/envelope.ts`（describe 信封校验）
- `src/server/dshRpc.ts`（所有 callRpc/fetch 调用点）
- `src/server/hostEvents.ts`、`src/server/muxEvents.ts`（WS 连接的认证方式）

## 变更记录

- 2026-09-03 沙盒 spike（docker code-server + dsh@next）中发现并核实，记录进 open/。
- 2026-09-04 主 session 核实 0.1.2-rc.1 源码（dsh-client-connection / dsh-api-gateway 子包）→ 认证模型定案（launch token 换签名 cookie；token 不可直接调 API；loopback 不免认证）→ 用户拍板按官方标准路径实施（解析 stdout → 换 cookie → 全链路带 cookie）→ 条目更新（仍 open/，未开发；实施时验证 reload/stdout 丢失场景）。

- 2026-09-06 认领（open → doing，worktree: agent/dsh-token-auth）：按方案实施 token 换 cookie 认证链路。

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

## 建议方案

待确认 dsh 0.1.2 的认证设计（token 给谁用、API 是否也要、spawn 方如何拿到 token）。可能的方向：

1. 扩展 spawn dsh 时从 stdout 解析 token URL（`dsh web: http://...?token=***` 那行），后续所有 RPC/WS 请求携带；probe 同步改造。
2. 或与 dsh 侧约定：本机 loopback + 由本扩展 spawn 的实例免认证。
3. 短期缓解：扩展安装引导里把 dsh 版本 pin 到 0.1.1 系列，文档写明不兼容 0.1.2。

## 涉及代码位置

- `src/server/manager.ts`（probePort / waitReady / spawn 输出解析）
- `src/pure/envelope.ts`（describe 信封校验）
- `src/server/dshRpc.ts`（所有 callRpc/fetch 调用点）
- `src/server/hostEvents.ts`、`src/server/muxEvents.ts`（WS 连接的认证方式）

## 变更记录

- 2026-09-03 沙盒 spike（docker code-server + dsh@next）中发现并核实，记录进 open/。

# 官方 AppFrame 形态适配原型（#89）

这个目录是 **#89 的评估原型**，不是生产代码路径的一部分，也不进任何一棵生产树的
block list / 插件清单。它回答一个问题：

> 三棵装配树改成**让官方 `@deepseek-ai/dsh-client-ui-layout` 的 AppFrame 渲染 root**、
> 我们只做 VS Code 形态适配，会是什么样、要付出什么代价？

结论与实测数据写在 issue #89 的决策记录里（`docs/official-frame-prototype-findings.md`）。
本文件只讲怎么跑、能看什么。

## 跑法

```bash
npm run build                                             # 先把自有插件 bundle 打出来（prototypes 会往里加原型插件）
node test/assembly-lab/prototypes/officialFrame/run.ts    # 全场景跑测（默认端口 3313）
node test/assembly-lab/prototypes/officialFrame/run.ts --only P-01,P-02
node test/assembly-lab/prototypes/officialFrame/run.ts --keep   # 跑完留服务器，人工点页面
```

参数：`--port`（原型实验室端口，缺省 3313）、`--compare-port`（现状对照用的生产实验室端口，
缺省 3314）、`--gateway` / `--token`（同实验室）、`--out`（产物目录，缺省
`test/assembly-lab/out/proto`）、`--only <ids>`、`--keep`。

产物（都在 gitignored 的 `test/assembly-lab/out/proto/` 下）：

- `official-frame.ledger.json` —— 台账（事实源）
- `official-frame.report.html` —— 单文件报告（截图内嵌，可直接分发）
- `shots/*.png` —— 各场景截图

前置条件与实验室一致：本机跑着一个 dsh 网关（缺省 3080，launch token 能从
`~/.dsh/dsh-owned.json` 读到）、`npm run build` 过。网关**只读**：跑测前后各数一次会话数，
必须一样（台账里的 P-99）。

**端口**：原型实验室 3313、生产对照实验室 3314。其它并行 session 在用 3299 / 3311 / 3403，
不要撞。

## 目录里的东西

| 文件 | 是什么 |
| --- | --- |
| `trees.ts` | 三棵原型树 = 生产三棵树各自**去掉「block 官方 ui-layout」这一条** + 一个原型形态插件；另加一棵**控制组**（同一棵 chat 树，只差「谁渲染 root」） |
| `shape.ts` | 官方 AppFrame 的结构与几何事实（三轨、内联样式、哈希类名）+ 公共件：轨道切分、内联轨道改写器、CSS 注入 |
| `plugins/chatShape.ts` | chat 树形态插件：零侧栏列（`?shape=js` 内联轨道改写 / `css0` 纯 CSS 硬写轨宽 / `raw` 官方原样） |
| `plugins/sidebarShape.ts` | sidebar 树形态插件：单列铺满（`?shape=fill` / `raw`），含窄容器下用官方 `ctx.layout.toggleSidebar()` 打开展开态 |
| `plugins/settingsShape.ts` | settings 树形态插件：设置页当**官方 keyed `main`** 全局面板（`ctx.layout.selectPanel`）+ 去侧栏列（`?shape=page` / `raw`） |
| `plugins/themeProbe.ts` | 诊断件：把主题服务的偏好与每次 `theme/change` 打进 console（A/B 实验用） |
| `build.ts` | 三个原型插件用 esbuild 打成与生产插件同格式的自注册 bundle |
| `server.ts` | 原型实验室服务器（生产模块 + 原型三棵树；`labServer.ts` 的原型版） |
| `run.ts` | Playwright 跑测：开页 → 截图 → 量几何 → 写 ledger/报告 |

## 为什么原型自己起一份实验室服务器

`labServer.ts` / `suites.ts` 正被其它并行分支改（#81/#82/#87），原型按任务要求
**单独建文件**、不动共享文件，避免互相踩。原型的三棵树用的是**生产同一份**
`pageHtml` / `wireFilter` / `assemblyMirror`，差别只在「树定义」这一个入参。

原型插件的 bundle 落在 `dist/assembly/plugins/`（mirror 只有一个 `pluginsDir`，
原型页要同时取到生产自有插件与原型插件）；`npm run build` 每次会重建该目录，
原型产物不会被提交。

## 形态档（`?shape=`）怎么读

- chat：`js`（内联轨道改写，缺省）、`css0`（纯 CSS 覆盖整条 `grid-template-columns`）、`raw`（官方原样）
- sidebar：`fill`（单列铺满，缺省）、`raw`
- settings：`page`（设置页当 keyed main，缺省）、`raw`

`raw` 档是每组对照的基准：它不做任何适配，就是「直接上官方 AppFrame」的样子。

# 开源项目质量基线补强（发布后不阻塞）

记录于 2026-08-31。Marketplace 审核不要求代码质量（仅禁混淆），本条目是面向"别人点进 GitHub 仓库"的信誉建设，均为发布后再做的小改进。

## 现状（已具备）

- TypeScript `strict: true` + `npm run typecheck`
- 10 个测试文件，`npm test`（node --test）覆盖核心纯逻辑
- README / CHANGELOG / LICENSE / repository 元数据齐全
- src 分层（pure / server / ui）

## 待做（按性价比排序）

1. ~~加 CI~~（已完成：`.github/workflows/ci.yml` 在 push/PR 时跑 typecheck/test/build，README 已挂 badge）
2. **README 加截图/动图**：市场详情页即 README，纯文字转化率低。加一张 VS Code 内嵌 dsh 面板的截图（放 `assets/` 用相对路径引用）。涉及：`README.md`、`assets/`。
3. **README 参照 dsh-mobile 结构与双语**：hero 横幅图 + 徽章行（CI/npm/许可/平台）+「能做什么」清单 + 快速开始代码块 + 工作原理（mermaid）+ 安全/权限说明 + 兼容性（VS Code 版本 / dsh 版本）+ 卸载 + 开发 + 中英双语 README（README.en.md）。当前 README 78 行、纯中文、无截图、无工作原理图。
4. **仓库元数据补齐**：`imchangchang/dsh-one` 当前 description 为空、topics 为空、0 stars（建仓 5 天）。先补 description（一句话双语）+ topics。
5. **topic 决策（调研结论）**：`dsh-plugin` 语义上指「可 `dsh plugin add` 安装的 cordis 插件」（dsh-desktop 打此 tag 因为桌面本身是插件；dsh-mobile 打此 tag 因为仓库核心是插件）。dsh-one 是纯 VS Code 扩展，名不副实；且 awesome-dsh-plugin 收录标准明确要求声明 `dsh.bundle` manifest、`dsh plugin add` 可装，纯扩展进不了该列表。→ 暂不打 `dsh-plugin`，改打 `dsh`/`deepseek-harness`/`vscode-extension`；若后续给扩展加真正的 cordis 插件侧（如 web 注入「在 VSCode 中打开」桥），再补 `dsh-plugin` 并申请收录。

## 明确不做

覆盖率门禁、commitlint、PR/issue 模板——单人维护阶段是负担。
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领（→ doing）：先做 README 顶部加图标（README.md + assets/icon.png），topic/元数据后续再议。

- 2026-09-01 合入确认（done → closed）：README 顶部图标已合入 main 并重建 dist（223 测试全绿）。

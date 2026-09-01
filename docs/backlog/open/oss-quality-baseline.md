# 开源项目质量基线补强（发布后不阻塞）

记录于 2026-08-31。Marketplace 审核不要求代码质量（仅禁混淆），本条目是面向"别人点进 GitHub 仓库"的信誉建设，均为发布后再做的小改进。
（2026-09-01 原条目做完「README 顶部图标」后关到 closed/，本条为剩余项重新开回。）

## 现状（已具备）

- TypeScript `strict: true` + `npm run typecheck`
- 10 个测试文件，`npm test`（node --test）覆盖核心纯逻辑
- README / CHANGELOG / LICENSE / repository 元数据齐全
- src 分层（pure / server / ui）

## 已做

- ~~CI~~（`.github/workflows/ci.yml` 在 push/PR 时跑 typecheck/test/build，README 已挂 badge）
- ~~README 顶部居中图标~~（2026-09-01 合入，merge e9574ef）

## 待做（按性价比排序）

1. **README 加截图/动图**：市场详情页即 README，纯文字转化率低。加一张 VS Code 内嵌 dsh 面板的截图（放 `assets/` 用相对路径引用）。涉及：`README.md`、`assets/`。
2. **README 参照 dsh-mobile 结构与双语**：hero 横幅图 + 徽章行（CI/npm/许可/平台）+「能做什么」清单 + 快速开始代码块 + 工作原理（mermaid）+ 安全/权限说明 + 兼容性（VS Code 版本 / dsh 版本）+ 卸载 + 开发 + 中英双语 README（README.en.md）。当前 README 纯中文、无工作原理图。
3. **仓库元数据补齐**：`imchangchang/dsh-one` 当前 description 为空、topics 为空、0 stars。先补 description（一句话双语）+ topics。
4. **topic 决策（调研结论，待用户拍板）**：实测同类纯 VS Code 扩展（Fengze233/dsh-vscode、Lixxx1/dsh-vscode）虽无 `dsh.bundle` 也打 `dsh-plugin`，但都进不了 awesome-dsh-plugin 列表（该列表要求 `dsh plugin add` 可装）。→ `dsh-plugin` 可打（当生态标签用），但不指望进精选列表；若后续给扩展加真正的 cordis 插件侧再申请收录。推荐组合：`dsh`、`deepseek-harness`、`dsh-plugin`、`vscode`、`vscode-extension`、`bridge`。

## 明确不做

覆盖率门禁、commitlint、PR/issue 模板——单人维护阶段是负担。
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-01 用户确认：description/topics 元数据与 `dsh-plugin` topic 暂不实施，仅记录在案（条目保持 open）。

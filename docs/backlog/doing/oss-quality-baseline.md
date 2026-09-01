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
- ~~README 参照 dsh-mobile 结构重写~~（2026-09-01 开发完成）：hero 横幅（`assets/hero.svg` 纯矢量内联像素鱼，无外部引用）+ 徽章行（CI/license/平台/VS Code 版本；不放 npm 徽章——扩展不是 npm 包，也未发布到 marketplace）+「能做什么」清单 + 快速开始 + 工作原理 mermaid + 安全/权限 + 配置项 + 兼容性（VS Code ^1.96.0 / dsh 版本要求）+ 已知限制 + 卸载 + 开发。中英双语按用户拍板：**README.md 改英文（GitHub 默认页）+ 原中文移到 README.zh-CN.md**（非条目原拟的 README.en.md），两文件互链。截图按要求**留占位**（TODO 注释 + 说明），未生成 AI 渲染截图，待用户在真实 VSCode 补。

## 待做（按性价比排序）

1. ~~README 加截图/动图~~（结构已就位，截图留占位待用户补，见上）
2. ~~README 参照 dsh-mobile 结构与双语~~（开发完成，见上）
3. **仓库元数据补齐**：`imchangchang/dsh-one` 当前 description 为空、topics 为空、0 stars。先补 description（一句话双语）+ topics。
4. **topic 决策（调研结论，待用户拍板）**：实测同类纯 VS Code 扩展（Fengze233/dsh-vscode、Lixxx1/dsh-vscode）虽无 `dsh.bundle` 也打 `dsh-plugin`，但都进不了 awesome-dsh-plugin 列表（该列表要求 `dsh plugin add` 可装）。→ `dsh-plugin` 可打（当生态标签用），但不指望进精选列表；若后续给扩展加真正的 cordis 插件侧再申请收录。推荐组合：`dsh`、`deepseek-harness`、`dsh-plugin`、`vscode`、`vscode-extension`、`bridge`。

## 明确不做

覆盖率门禁、commitlint、PR/issue 模板——单人维护阶段是负担。
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-01 用户确认：description/topics 元数据与 `dsh-plugin` topic 暂不实施，仅记录在案（条目保持 open）。

- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成，自测通过 → done（worktree: agent/oss-quality-baseline）

### 人工验收方法（合入前）

1. GitHub 仓库页看 README 渲染：hero 横幅（`assets/hero.svg`）显示为深蓝渐变 + 像素鱼 + 标题，徽章行 4 个徽章可点，两语言互链正常（README.md ↔ README.zh-CN.md）。
2. mermaid「工作原理」图能渲染、节点与连线完整。
3. 相对路径图片可访问：hero.svg 在仓库内（GitHub 上直接打开 `assets/hero.svg` 应显示横幅）。
4. 截图占位：README 两文件「截图」节当前为说明文字（TODO 注释）。补截图的步骤：真实 VSCode 里 `npm run build` + F5 起扩展宿主，打开 DSH One 侧边栏 Chat 面板和 Sessions 树，截图存 `assets/screenshots/chat-panel.png`（可再加 `sessions-sidebar.png`），替换 README 两文件「截图」节的占位说明为 `<img src="assets/screenshots/chat-panel.png" ...>`（相对路径），删除 TODO 注释。
5. 构建不破坏：`npm run typecheck && npm test && npm run build` 全绿（dev-finish 已跑）。

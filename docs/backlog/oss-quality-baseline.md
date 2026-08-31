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

## 明确不做

覆盖率门禁、commitlint、PR/issue 模板——单人维护阶段是负担。

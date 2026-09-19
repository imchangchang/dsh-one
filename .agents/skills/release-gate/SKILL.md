---
name: release-gate
description: 发布 dsh-one 到 VS Code Marketplace 的完整操作与验收流程：发布执行与独立验收分两个子代理——发布子代理跑 scripts/release-gate.sh 收口（version + CHANGELOG）并打 tag，tag push 后由 GitHub Actions（release.yml）构建 vsix 挂到 GitHub Release；验收子代理不信发布报告、下载 Release 产物独立重验并生成人工 GUI 验收清单。当要发版、走发布流程、验收 vsix 产物时使用。
---

# 发布流程（release-gate）

把发布串成一条可执行、可验收的流程：**发布执行**和**独立验收**分两个子代理完成，人工只做 GUI 沙盒装机和最终 publish。

## 核心规则

- **两个角色，两个子代理**：发布执行代理、独立验收代理。串行派发——先发布完成（收口 + tag + push），等 Actions 出 Release 产物，再派验收（验收对象 = GitHub Release 的 vsix）。
- **验收代理不信任发布代理**：不采信发布报告，自动化校验全部自己重跑（dry-run 一致性 / 下载 Release 产物 unzip 验 vsix / git 验 tag）。
- **版本号由调用方给定**（正式版 patch+1；预发布 `x.y.z-rc.N` 内测用），发布代理不擅自决定；`scripts/release-gate.sh --apply` 交互输入版本，子代理用 `echo "<版本>" | bash scripts/release-gate.sh --apply` 管道喂入。
- **预发布（rc）与正式版是两步**：rc 只 bump package.json（CHANGELOG [Unreleased] 不消费），GitHub Release 标 prerelease；内测通过后发同核心正式版（如 1.0.0-rc.1 → 1.0.0）才收口 CHANGELOG、才 vsce publish。
  **rc 上不了市场**：市场只接受 `major.minor.patch` 三段版本号，semver 预发布标记（`-rc.N`）不被支持（[Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) 的 Pre-release extensions 一节原话：semver pre-release tags are not supported），所以 `x.y.z-rc.N` 只能以 GitHub Release 的 prerelease 形式内测。市场自己的 pre-release 通道（`vsce publish --pre-release`）用的也是三段号（官方建议正式版 `major.偶数.patch`、预发布 `major.奇数.patch`），我们的 `-rc.N` 版本号用不了，因此不采用。
- **构建产物一律来自 GitHub Actions**：`release.yml` 在 tag push 时打包 + 验 vsix + 挂 GitHub Release；本地不打包（release-gate.sh 已去掉打包段）。
- **release-gate.sh 不跑 vsce publish**：发布动作永远由人执行，且用验收通过的那份（GitHub Release 下载的 vsix），不重打包。
- **GUI 沙盒装机 headless 子代理做不了**（起不了 VS Code 窗口）：验收代理只做自动化核验 + 把 GUI 项整理成待人工清单，人工部分由调用方转交用户。
- 发布在**干净工作树**上进行（通常是合入后的 main；发布提交 = bump + tag，不属于功能开发）。要发布的功能都已经过 `worktree-dev-flow` 的合入门禁（两道静态自检 + 测试报告审查）合进 main，发布这一步不再跑那些检查。

## 前置条件

- `.github/workflows/release.yml`、`scripts/release-gate.sh`、`scripts/verify-vsix.sh`、`docs/release-checklist.md` 已合入 main。
- 仓库工作树干净、当前分支是 main、`CHANGELOG.md` 有 `[Unreleased]` 段、无 `v<新版本>` 的 tag。
- 不确定时先跑 `bash scripts/release-gate.sh`（dry-run，只读）看状态。

## 流程

### 1. 派发布执行子代理

串行第一步。prompt 模板（`<仓库路径>`、`<新版本号>` 由调用方填）：

```
你是发布执行代理。目标：在 <仓库路径>（main，工作树干净）把当前版本发布为 <新版本号>。严格按脚本输出行事，任何一步报错就停下报告，不要绕过校验。
- 用 bash 执行：echo "<新版本号>" | bash scripts/release-gate.sh --apply
- 第一遍：脚本会 bump package.json version → <新版本号>，然后停下。正式版同时把 CHANGELOG [Unreleased] 收口成 [<新版本号>]；预发布（<新版本号> 含 -rc.）不消费 CHANGELOG。git diff 确认改动范围（正式版 = package.json + CHANGELOG.md；rc = 只 package.json），然后提交：
  git add package.json CHANGELOG.md && git commit -m "release: v<新版本号>"
- 第二遍：scripts/release-gate.sh --tag 打 annotated tag v<新版本号>（== HEAD）。
- 然后 push 触发构建：
  git push origin main && git push origin v<新版本号>
- 等 .github/workflows/release.yml 跑完（gh run watch 或 gh run list），确认 GitHub Release v<新版本号> 出现 dsh-one-<新版本号>.vsix：
  gh release view v<新版本号> --repo imchangchang/dsh-one
- 门禁报错是预期行为：停下报告，等调用方决定（修复后重跑即可，bump commit 保留，不用重跑第一遍）。
- 完成标准：报告 tag v<新版本号> 指向的 commit、release.yml run 链接、GitHub Release 的 vsix 资产名。
- 禁止：擅自改版本号、跑 vsce package、跑 vsce publish、改 release-gate.sh 或绕过其校验。
```

### 2. 派独立验收子代理

Release 产出后。prompt 模板：

```
你是独立验收代理。目标：验收 <仓库路径> 上刚发布的 v<新版本号>（GitHub Release 产物）。不要信任发布代理的报告，全部自己重验，每项给出命令输出作为证据：
- 一致性：bash scripts/release-gate.sh（dry-run，只读）——检查输出中 package.json version == CHANGELOG [<新版本号>] == tag v<新版本号>，且 tag 指向 HEAD（收口 commit）。
- 下载 Release 产物：gh release download v<新版本号> --repo imchangchang/dsh-one --pattern "dsh-one-<新版本号>.vsix" --dir /tmp/dsh-relcheck/ ——下载的是 GitHub Release 上那份，不是本地打包。
- vsix 内容与版本：bash scripts/verify-vsix.sh /tmp/dsh-relcheck/dsh-one-<新版本号>.vsix <新版本号>——它同时查两件事：产物含 dist/extension.js、assets/、package.json、readme、license，且不含 src/ test/ docs/ scripts/ .agents/ AGENTS.md .map node_modules/ 与 .ts；以及 vsix 内 version == <新版本号>。再 unzip -l 抽查一眼内容清单。
- tag：git rev-parse v<新版本号>^{commit} == git rev-parse HEAD。
- 对照 docs/release-checklist.md：自动化可验项全部核验勾掉；GUI 项（沙盒装机）整理成「待人工验收清单」逐条列出，附沙盒安装命令（code --user-data-dir /tmp/dsh-relcheck/ --install-extension "/tmp/dsh-relcheck/dsh-one-<新版本号>.vsix"）。
- 输出验收报告：通过 / 不通过 + 每项证据。
```

### 3. 人工部分（调用方转交用户）

- 把验收代理生成的「待人工验收清单」+ 沙盒安装命令转交用户，按 `docs/release-checklist.md` 在真实终端完成沙盒装机验收（未装 dsh 降级 / 定位启动 / webview / 收养实例 / 进程回收 / 命令抽查）和 README 与版本确认。
- **rc 到这里就结束**（内测用；`-rc.N` 版本号上不了市场，见「核心规则」）；正式版全部通过后由人执行 `npx vsce login <publisher>` + `npx vsce publish --packagePath dsh-one-<新版本号>.vsix`（位置参数是版本号，发布已有 vsix 必须走 `--packagePath`），上传的是 Release 下载的那份。

## 交接物

vsix 下载路径（GitHub Release）/ 版本号 / tag commit / Release URL / 验收报告 / 待人工验收清单。

## 注意

- 两个子代理串行派发，不要并行——验收依赖 Release 产物。
- 验收代理重跑 dry-run 不写任何文件，安全；`gh release download` 只写 /tmp，不动仓库。
- 发布/验收都作用于真实仓库（通常是 main），不是 worktree；子代理是 headless 的，GUI 步骤一律交给用户。
- 验收不通过：正式版不沿用同一版本号重发（市场不接受同版本再次发布，`release-gate.sh --tag` 也会拒绝已存在的 tag），修 bug → bump patch+1 → 重走本流程；**rc 不通过则可以 bump rc.N（如 1.0.0-rc.1 → rc.2）重新出内测版**；已建的 Release v<旧版本> 保留作历史，别删（`release.yml` 撞到已存在的 Release 会直接报错，不覆盖）。

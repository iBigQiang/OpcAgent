# 当前迭代任务清单

> 用法：开工前把可核对的检查项写在这里，随执行进度勾选，收尾时补「结果复盘」。
> 历史迭代的完整记录在 `docs/DEVLOG.md`，用户可见变更在 `CHANGELOG.md`。

---

## 2026-09-28 · CI 修复与推送后自动打包、README 更新

- [x] 下载 GitHub run 36367008439 日志，复现 Electron mock 导出污染导致的 BrowserView 缺失。
- [x] 通过现有测试进程隔离机制修复，保留全部测试和打包前质量门禁；冲突测试共 80 项通过。
- [x] 保留默认分支 main，设计各推送分支分别更新自己的 README。
- [x] 三平台制品保留期设为 30 天，名称绑定源码 SHA 和运行轮次。
- [x] 完成真实制品收集、README 局部更新及审计哈希同步的边界测试：37 项、122 个断言通过。
- [x] 完成本地 validate:ci、lint、Craft 审计与对抗式审查。
- [x] 推送当前开发分支，最终验证源码提交为 46ce629。
- [x] GitHub run 36416806387 全部成功：4395 项测试通过、11 项跳过、0 失败，三平台制品真实上传。
- [x] README 机器人提交 40b8901 已生成，只改 README 和对应审计哈希；未递归触发新 CI。
- [x] 快进同步机器人提交到本地，保留 main 默认分支与现有内容。

普通推送只产生验证安装包，不自动发布正式 Release 或创建版本 tag。详细使用说明见 `docs/zh/releases.md`。

验收链接：https://github.com/iBigQiang/OpcAgent/actions/runs/36416806387 。Windows 既有平台测试差异没有扩展修复，最终全量结果来自 GitHub Linux runner。此配置已在 craft-sources-auto 生效，合并到 main 后 main 使用同样流程。

### 0.1.11 正式发布补充收尾

- [x] 纠正发布边界：目标分支可直接承载正式版本，无需先合并 main；Release 由指向该分支提交的注解标签触发。
- [x] `bun run release:check v0.1.11` 验证版本、Changelog 与中文内置说明一致。
- [x] 推送不带跳过标记的发布收尾提交；CI 36420500156 与 README 机器人写回全部成功。
- [x] 在同步后的 `craft-sources-auto` 最新提交 `b11cd0f` 创建并推送注解标签 `v0.1.11`。
- [x] Release workflow 36422082890 全部成功，`0.1.11` 已发布为非草稿、非预发布的 Latest。

正式 Release 共 22 个资产，覆盖 Windows x64、macOS arm64/x64、Linux x64、CLI、四个平台无头服务器、更新 manifest、`SHA256SUMS` 与 `SIGNING_STATUS.txt`。标签对象解引用到 `b11cd0f7b894d030af0d7d749c1d4eea65601e35`，未合并或修改 main。

---

## 2026-09-28 · 会话跨渠道切换与 0.1.11 交付

- [x] 实现 Pi 会话切换渠道与模型，保留 SDK 上下文及工具能力，自动化任务绑定隔离。
- [x] 完成七组聚焦验证：142 项测试、719 个断言。
- [x] 修复既有分支测试字段及 Windows 路径夹具，相邻 27 项回归通过。
- [x] 逐项审查并登记 13 个 Craft 基线差异。
- [x] 真实 DeepSeek 与 Gemini A→B→A、工具续接及重启恢复通过。
- [x] 修复 Windows 启动环境内置 Bun 定位与会话解析不一致。
- [x] 准备 0.1.11 版本与中文发布说明，Electron 构建通过。
- [x] 生成 Windows x64 安装包，并使用打包后的真实主进程完成隔离桌面验收。
- [x] 完成最终 validate:ci、lint、Craft 审计和版本检查。
- [x] 审查提交内容，推送 origin/craft-sources-auto 并核对远端 SHA，功能提交为 f0db0a9。

详细证据与执行边界见 `tasks/goal-session-channel-model-switching.md` 第十二节。

---

## 2026-08-26 · 工程基线整理（基于 v0.1.10）

### 1. 清 pnpm 残留

- [x] 确认 `.pnpm-store/`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` 在 `package.json` / `.github/` / `scripts/` / `bunfig.toml` 中零引用
- [x] 删除三者
- [x] `.gitignore` 把孤立的 `pnpm-lock.yaml` 扩成完整一节（+ `pnpm-workspace.yaml`、`.pnpm-store/`）并注明原因
- [x] 补 `.tmp/`（原有 `tmp` 规则匹配不到带点目录）
- [x] 发现第二阶段污染：`node_modules/.pnpm/`（777M / 1225 包）、`node_modules/.modules.yaml`、30 个指向 `.pnpm` 的顶层软链（含 `react` / `typescript` / `react-dom` / `tiptap-markdown`）
- [x] 定性 `typecheck:all` 那 2 个报错的根因：`@tiptap/core` 两份副本 → `Two different types with this name exist, but they are unrelated`
- [x] 确认报错与本轮改动无关：两个报错文件相对 HEAD 零内容差异；`.pnpm/` 与 `typescript` 软链创建时间同为 2026-08-18 17:11:23
- [x] 隔离重装：`mv node_modules .tmp/node_modules-pnpm-tainted` → `bun install`（1542 包 / 88.65s）
- [x] 记录 `--frozen-lockfile` 失败的独立根因：`@types/bun: "latest"` 与 frozen 天然互斥
- [x] 重装后自检：无 `.pnpm/`、无 `.modules.yaml`、0 个 pnpm 软链、`@tiptap/core` 仅 1 份、顶层软链仅 12 个 `@opcagent/*`

### 2. 行尾治理

- [x] 定位根因：目标文件 2312 CRLF + 96 裸 LF 混杂；索引/HEAD/工作区规范化后三个 hash 相同，证明仓库对象层面早已是 LF
- [x] 全仓库扫描：混杂 137、纯 CRLF 1220、纯 LF 246
- [x] 发现真实缺陷：`resources/bin/` 下 8 个 `#!/bin/sh` 包装脚本为 CRLF，Windows 上打 Linux/macOS 包会让 shebang 解析失败
- [x] 新建 `.gitattributes`（默认 LF；sh/nsh/py/resources/bin 显式 LF；cmd/bat/ps1 显式 CRLF；18 类二进制；`bun.lock` 标 generated）
- [x] `git check-attr` 验证规则生效（含同目录 `.cmd` 被后置规则正确覆盖为 CRLF）
- [x] 以 `git check-attr` 为唯一权威规整工作区，改写 1371 个文件
- [x] 验证零内容影响：`git add -A` 后索引仅含 `.gitattributes` + `.gitignore`
- [x] 复核 1636 个文本文件行尾，0 处不符；8 个 sh 脚本转 LF、11 个 Windows 脚本保持 CRLF

### 3. 补流程底座

- [x] `CLAUDE.md`（指针 + 七条铁律，不复述 architecture/development 文档）
- [x] `docs/DEVLOG.md`
- [x] `tasks/todo.md`（本文件）
- [x] `tasks/lessons.md`

### 4. 文档滞后

- [x] `README.md` 的 "Current release" 段由 0.1.4 同步到 0.1.10

### 5. 验证

- [x] `git status` 只剩预期改动
- [x] 行尾逐文件核对
- [x] **`bun run validate:ci` 退出码 0**（项目正式门禁：typecheck + 3 组 shared 测试 + doc-tools + i18n 三检查）
- [x] `bun run typecheck:all` 通过（清 pnpm 残留前 2 个报错 → 清理后 0）
- [x] `bun run lint:craft-ui-sync` 通过（确认行尾变动未影响 sha256 清单）
- [x] `bun run lint:craft-test-coverage` 通过
- [x] 全量 `bun run test`：4239 tests / 361 文件、46 fail，逐一定性为 Windows 平台既有失败（CI 跑 `ubuntu-latest`，`run-tests.ts` 无平台过滤）
- [x] 对照实验证明行尾零影响：同一测试文件 LF 与 CRLF 均 429 pass / 15 fail，15 个失败名逐一相同

### 6. 收尾处理（确认后追加）

- [x] `@types/bun` 两处（`package.json:95`、`apps/cli/package.json:27`）由 `"latest"` 钉到 `1.3.14`，与 `bun --version` 对齐
- [x] `bun install` 刷新 lock，`+ @types/bun@1.3.14`
- [x] **治本验收：`bun install --frozen-lockfile` 退出码 0**（此前必失败）
- [x] 确认钉版本消除了双版本共存：root 1.3.6 → 1.3.14、`@opcagent/cli/@types/bun` override 记录整条消失、lock 4166 → 4160 行
- [x] 钉版本后重跑 `validate:ci`，显式捕获 `EXIT=0`
- [x] 钉版本后重跑全量 `bun run test`，失败集合与钉版本前 `diff` 为空（均 46 个）
- [x] 删除隔离目录 `.tmp/node_modules-pnpm-tainted`（3.2G）
- [x] 删除 `~/` 与 `packages/~/` 两棵目录树（43 个测试产物文件）
- [x] 纠正前一轮的错误判断：这两个目录**非空**，且每跑一次 `bun run test` 就重新生成
- [x] 尝试治本并**主动回退**：给 `run-tests.ts` 的 `Bun.spawnSync` 补 `env: process.env` —— 探针证明 env 不是根因，且失败数由 46 涨到 48
- [x] 确认 `run-tests.ts` 已回退到与 HEAD 零差异
- [x] 排除 `apps/electron/release/` 构建产物的疑虑：0 个被 git 跟踪（`apps/electron/.gitignore:4`），且 `run-tests.ts` 用 `git ls-files --exclude-standard` 发现测试，不会扫到
- [x] `CLAUDE.md` 铁律 1 补入「依赖一律钉确切版本」硬约束
- [x] `lessons.md` 追加 L8（`latest` 的双版本危害）、L9（删残留要验证不复发 + 根因未定性别写成结论）

---

## 结果复盘

三项任务全部落地，并在收尾验证时挖出一个潜伏 8 天的真实故障。

**做成了什么**

1. **pnpm 残留清除** —— 仓库层面删 `.pnpm-store/`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` 并在 `.gitignore` 成节屏蔽；`node_modules` 内部的 `.pnpm/` 存储层与 30 个软链通过隔离重装彻底清除。
2. **行尾治本** —— `.gitattributes` 落地，1371 个文件规整，且证明 git 层面零内容差异。
3. **流程底座** —— `CLAUDE.md` / `docs/DEVLOG.md` / `tasks/todo.md` / `tasks/lessons.md` 四件齐备，`/newup` 与 `/ship` 有据可依。
4. **文档滞后修正** —— README 版本号 0.1.4 → 0.1.10，与 `package.json` / `CHANGELOG` / release-notes 四处一致。

**意外收获（本轮最有价值的部分）**

- 修掉一个会真出故障的缺陷：`resources/bin/` 下 8 个 `#!/bin/sh` 包装脚本原为 CRLF，在 Windows 上打 Linux / macOS 包会让 shebang 因结尾 `\r` 解析失败。
- 定性并修掉 `typecheck:all` 的 2 个报错 —— 根因是 8 天前误跑 pnpm 在 `node_modules` 内部留下的重复类型定义。报错落点（`packages/ui/.../markdown/`）与根因（依赖管理）毫无字面关联，这类问题不查依赖树是查不出来的。
- 发现并修掉一个独立的既有缺陷：`@types/bun: "latest"` 与 `--frozen-lockfile` 天然互斥。查下去还发现更隐蔽的一层 —— `latest` 让 root 与 `apps/cli` 锁到**两个不同版本**（1.3.6 / 1.4.0），`bun.lock` 为此多出一组 override 记录，两份类型声明并存，与 pnpm 造成的 `@tiptap/core` 双份属同类隐患。钉到 1.3.14 后 override 整条消失。

**方法上的教训**（已固化进 `lessons.md`）

- 「看起来无关」不等于「证明无关」：46 个测试失败从断言内容推理就能定性为平台差异，但仍做了 CRLF / LF 对照实验拿到硬证据（L7）。
- 第一次做对照实验时被 `grep -c $'\r'` 在 Git Bash 里恒返回 0 骗过，差点拿一个没真正转换过的文件当对照组 —— 验证行尾必须用字节统计（L7）。
- 差点在全量测试尚未返回时就写下「全量通过」（L5）。
- 在 Windows 上 `bun run test` 不是有效门禁，`validate:ci` 才是（L6）。
- 「删掉残留」删完要验证它不会再长出来 —— 我第一次把这两个目录判为「无害空目录」，实际非空且每跑一次测试就重新生成（L9）。
- 根因没定性就别把猜想写成结论 —— 我一度把 `env` 缺失当根因写进了教训和代码注释，被探针推翻后重写为「已排除的假设 + 证据」（L9）。
- 一行「零风险」的改动也必须跑完整验证：`env: process.env` 看着无害，实测让失败数由 46 涨到 48（L9）。

### 下一步候选

- `~/` 与 `packages/~/` 两棵目录树的成因未定性 —— 每跑一次 `bun run test` 就重新生成。已排除「`Bun.spawnSync` 未传 `env`」（附探针证据，见 L9）。被 `.gitignore:38` 屏蔽，危害有限，但根因仍在。
- 全量 `bun run test` 在 Windows 上的 46 个既有失败 —— 治本需给 `scripts/run-tests.ts` 加平台过滤，或修正各测试的路径/信号假设。属独立议题。
- 本轮无用户可见行为变化，未写入 `CHANGELOG.md` 的 `[Unreleased]`；下次发版前需确认该段是否仍为空。

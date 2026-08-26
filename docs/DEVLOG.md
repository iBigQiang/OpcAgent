# DEVLOG

开发日志：方案决策、实施细节、状态追踪。**最新的在最前面。**

分工：面向用户的版本变更写在 `CHANGELOG.md`；本文件记录「为什么这么做、怎么做的、还剩什么」。当前迭代的可核对清单在 `tasks/todo.md`，踩过的坑固化在 `tasks/lessons.md`。

---

## 2026-08-26 · 工程基线整理（基于 v0.1.10，未发版）

### 背景

`/newup` 预热时发现三类与功能无关、但会持续消耗注意力的问题：

1. **pnpm 残留** —— 工作区里有 `.pnpm-store/`（56K）、`pnpm-workspace.yaml`（内容还是 pnpm 生成的 `set this to true or false` 占位模板）、`pnpm-lock.yaml`（428K）。本项目以 `bun.lock` 为唯一事实来源，这三者是一次误跑 `pnpm install` 的产物，且 `.gitignore` 只屏蔽了 `pnpm-lock.yaml`，另两个一直挂在 untracked 里。**这次误跑的真正代价其实在 `node_modules` 内部，收尾跑类型检查时才暴露，见下文。**
2. **行尾混乱** —— `packages/shared/src/unified-network-interceptor.ts` 长期显示 modified 但 `git diff` 为空。逐字节查证后确认：该文件是 2312 个 CRLF + 96 个裸 LF 混杂。全仓库扫描发现同类混杂文件 137 个、纯 CRLF 1220 个、纯 LF 246 个。
3. **流程文档缺位** —— 没有项目级 `CLAUDE.md`、`docs/DEVLOG.md`、`tasks/`，`/newup` 与 `/ship` 无据可依；`README.md` 的 "Current release" 段仍写 0.1.4，实际已是 0.1.10。

### 方案与实施

**1. 清 pnpm 残留**

删除 `.pnpm-store/`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`。删前已确认三者在 `package.json`、`.github/`、`scripts/`、`bunfig.toml` 中零引用。`.gitignore` 把孤立的 `pnpm-lock.yaml` 一行扩成一节（含 `pnpm-workspace.yaml`、`.pnpm-store/`）并写明原因，同时补上 `.tmp/`（原有 `tmp` 规则匹配不到带点的目录）。

**收尾跑 `typecheck:all` 时才发现，这次误跑 pnpm 的真正代价不在仓库里，而在 `node_modules` 内部。** 报错两个，落点在 `packages/ui/src/components/markdown/`（`remarkCollapsibleSections.ts`、`TiptapMarkdownEditor.tsx`），信息是 `Two different types with this name exist, but they are unrelated` —— 字面上跟依赖管理毫无关联。查下去：pnpm 在 `node_modules/.pnpm/` 建了 777M / 1225 个包的存储层、写了 `node_modules/.modules.yaml`，并把 30 个顶层包（`react`、`typescript`、`react-dom`、`tiptap-markdown` 等）换成指向它的软链。于是 `@tiptap/core` 存在两份副本：`packages/ui` 的代码解析到 bun 装的真实目录，`tiptap-markdown` 顺着软链解析到 pnpm 那份，TypeScript 认定是两个互不相关的类型。

`.pnpm/` 与 `node_modules/typescript` 软链的创建时间同为 `2026-08-18 17:11:23` —— 同一次误跑，潜伏了 8 天。报错文件相对 HEAD 零内容差异，可确认与本轮行尾改动无关。

处理：`mv node_modules .tmp/node_modules-pnpm-tainted`（先重命名而非删除，装不回来能立刻还原）后重装。`bun install --frozen-lockfile` 在此失败，报 `lockfile had changes, but lockfile is frozen` —— 这暴露出**另一个独立问题**：root 与 `apps/cli` 的 `package.json` 把 `@types/bun` 写成 `"latest"`，与 frozen-lockfile 天然互斥，上游每发一版，README 与 CI 的这条安装命令就会失败。改用 `bun install` 装上 1542 个包（88.65s）。

`bun.lock` 因此有 4 行变更：`@opcagent/cli/@types/bun` 及其 `bun-types` 由 1.3.14 升到 1.4.0（纯类型包，无运行时影响），这两条记录的 registry URL 由华为云镜像变为空串 —— lock 里原本就有 87 条空 URL，其余 1792 条镜像 URL 原样保留，变更局部。

重装后自检：`.pnpm/` 与 `.modules.yaml` 均不存在、指向 `.pnpm` 的软链 0 个、`@tiptap/core` 只剩 1 份、顶层软链只剩 12 个 `@opcagent/*` workspace 包。`typecheck:all` 随即由 2 个报错转为 0。

**2. 行尾治理**

先确认问题边界：目标文件的索引 blob、HEAD blob、工作区规范化后的 hash 三者完全相同 —— 说明**仓库对象层面早已统一为 LF**（`core.autocrlf=true` 在起作用），混乱只存在于本地工作区的物理字节。假 modified 的成因是物理内容与「git 期望 checkout 出的内容」不一致。

期间发现一个真实缺陷：`apps/electron/resources/bin/` 下 8 个 `#!/bin/sh` 包装脚本（`doc-diff`、`markitdown` 等）在工作区是 CRLF。一旦在 Windows 上打包 Linux / macOS 版本，shebang 会因结尾的 `\r` 而解析失败。这是加 `.gitattributes` 从「洁癖」变成「必要」的那个理由。

新建 `.gitattributes`：默认 `* text=auto eol=lf`；`.sh` / `.nsh` / `.py` / `resources/bin/*` 显式 LF；`.cmd` / `.bat` / `.ps1` 显式 CRLF（放在 `resources/bin/*` 之后，靠后置规则覆盖同目录的 `.cmd`）；18 类二进制显式 `binary`；`bun.lock` 标 `linguist-generated` 且不参与 diff。

随后以 `git check-attr` 为唯一权威（而非在脚本里复写一套规则）批量规整工作区：1768 个文件里 1625 个目标 LF、11 个目标 CRLF、132 个二进制跳过，实际改写 1371 个。改写后 `git add -A` 重算哈希确认：索引相对 HEAD **只有 `.gitattributes` 与 `.gitignore` 两处真实改动**，1371 个文件零内容差异。

值得记一笔的先例：`scripts/check-craft-ui-sync.ts` 在算 sha256 前已经把 `\r\n` 归一为 `\n`（对应历史提交 `482bb12 ci: normalize Craft hashes across platforms`），所以 Craft 复用审计的哈希清单对本次行尾变动天然免疫。

**3. 补流程底座**

- `CLAUDE.md` —— 只收「动手前必须先知道、否则会踩坑」的内容，不复述 `docs/architecture.md` 与 `docs/development.md`，改为指针 + 七条铁律（只用 Bun / 只有 `pi` 一个 backend / 9 条自定义 eslint 规则 / i18n 双语三道检查 / Craft 复用审计 / 测试不写 `$HOME` / 行尾）。
- `docs/DEVLOG.md`（本文件）、`tasks/todo.md`、`tasks/lessons.md`。

**4. 文档滞后**

`README.md` 的 "Current release" 段从 0.1.4 同步到 0.1.10。

**5. 收尾处理（依赖钉版本 + 残留清理）**

三项主任务之外，确认后追加执行：

- **`@types/bun` 钉到 `1.3.14`**（`package.json:95` 与 `apps/cli/package.json:27`），与 `bun --version` 及 README 声明的最低 bun 版本一致。`bun install --frozen-lockfile` 由失败恢复为退出码 0（623ms）。收益比预期大：钉版本前 root 锁 `1.3.6`、`apps/cli` 锁 `1.4.0`，`bun.lock` 为此额外生成一组 `@opcagent/cli/@types/bun` override 记录 —— 同一个包两份类型声明并存，与前面 pnpm 造成的 `@tiptap/core` 双份属同类隐患。钉版本后 root 抬到 1.3.14、那组 override 整条消失，lock 由 4166 行降到 4160 行（镜像 URL 1794 → 1789、空 URL 87 → 89）。
- **删除隔离目录** `.tmp/node_modules-pnpm-tainted`（3.2G）—— 新依赖树已通过完整门禁，无需再留退路。
- **清掉 `~/` 与 `packages/~/` 两棵目录树**（43 个测试产物 `session.jsonl`）。原判断为「空目录残留」有误：实测非空，且每跑一次 `bun run test` 就重新生成。试过一版治本 —— 给 `scripts/run-tests.ts` 的 `Bun.spawnSync` 补 `env: process.env`，但探针证明 `env` 不是根因（子进程里 `tmpdir`/`TEMP`/`TMP` 全部正常），且该改动使失败数由 46 涨到 48，**已回退**。根因未定性，详见 `tasks/lessons.md` L9，留作独立待办。

### 验证

- `git add -A` 后索引仅含 `.gitattributes`（新增）与 `.gitignore`（+4 行），证明行尾规整零内容影响
- 1636 个文本文件行尾与 `.gitattributes` 逐一核对，0 处不符
- 8 个 `#!/bin/sh` 包装脚本确认已为 LF；11 个 `.cmd` / `.ps1` 确认仍为 CRLF
- **`bun run validate:ci` 退出码 0**（项目正式门禁，平台无关）：`typecheck:all` 0 报错、`test:shared:llm-connections` 46 pass / 0 fail、`test:shared:models-pi` 6 pass / 0 fail、`test:shared:config` 29 pass / 0 fail、`test:doc-tools` 通过、i18n parity（1530 keys）/ usage（1754 静态引用）/ sorted 全绿
- `lint:craft-ui-sync`、`lint:craft-test-coverage` 均通过 —— Craft renderer 边界（465 文件）与保留测试覆盖（373 Lite tests）未受影响
- 全量 `bun run test`：4239 个测试 / 361 文件、46 fail。逐一定性为 **Windows 平台既有失败**：CI 的 `bun run test` 跑在 `ubuntu-latest` 且 `scripts/run-tests.ts` 无平台过滤，失败集中在硬编码 `/` 分隔符、显式传 `'darwin'` 平台参数、Windows 无 SIGTERM、把 `C:\...` 插进 `bun -e` 模板字符串被当转义序列等处
- **行尾是否影响测试，做了对照实验而非只做推理**：把失败集中的 `packages/shared/tests/mode-manager.test.ts` 临时转回 CRLF（字节数 104210 → 106605，增量 2395 = 行数，确认转换真实发生），跑同一批测试 —— LF 与 CRLF 均为 429 pass / 15 fail，15 个失败测试名逐一相同，证明行尾变动对测试结果零影响
- 钉版本后重跑全量 `bun run test`：4193 pass / 46 fail / 4239 tests（169s），失败集合与钉版本前**逐一相同**（`diff` 为空），证明钉依赖与清理残留未引入任何新失败
- 钉版本后 `bun run validate:ci` 再次确认 **退出码 0**（本次显式捕获 `EXIT=0`）
- `bun install --frozen-lockfile` 退出码 0 —— README 与 CI 里的安装命令恢复可用，这是钉版本的直接验收标准

### 遗留

- `~/` 与 `packages/~/` 两棵目录树的成因未定性：每跑一次 `bun run test` 就重新生成，`.gitignore:38` 的 `~/` 规则将其屏蔽，因此不污染提交、不影响测试结果、CI 在 Linux 上不出现。已排除「`Bun.spawnSync` 未传 `env`」这一假设（附探针证据，见 `tasks/lessons.md` L9）。独立待办。
- 全量 `bun run test` 在 Windows 上的 46 个既有失败未处理 —— 属测试自身的平台假设问题（硬编码 `/` 分隔符、显式传 `'darwin'`、无 SIGTERM、`C:\` 被当转义序列等），CI 在 ubuntu 上不受影响。彻底解决需要给 `scripts/run-tests.ts` 加平台过滤或修正各测试的路径假设，属独立议题。
- 本轮为工程基线整理，无用户可见行为变化，故未写入 `CHANGELOG.md` 的 `[Unreleased]`。

---

## 历史（v0.1.1 – v0.1.10）

DEVLOG 自 2026-08-26 启用，此前的迭代记录见 `CHANGELOG.md`（用户视角）与 `git log`（实施视角）。主线脉络：

- 项目 fork 自 Craft `v0.11.4`，版本号重开为 0.1.x（`3073726 feat: rebrand project as OPC Agent`），renderer 相对上游的偏离由 `scripts/craft-*.json` 的 sha256 清单锁定
- **v0.1.4** 端点协议可编辑：AgentRouter 与自定义供应商支持选择 OpenAI Chat Completions / OpenAI Responses / Anthropic Messages / Google Gemini，保存前可预览生效请求路径。交付材料在 `docs/project-delivery/20260814-endpoint-protocols-v014/`
- **v0.1.7** 自动化编辑器支持 `@` Skill 自动补全与多 Skill 绑定，并内置自动化配置指南
- **v0.1.8** Windows 桌面行为收尾：点 X 默认最小化到任务栏、覆盖安装完成页从新目录启动、恢复自动化列表新增入口
- **v0.1.9 – v0.1.10** 品牌图标统一：所有展示位（安装包、窗口、系统通知、界面 Logo、WebUI favicon）从单一源图生成；修正 Windows 通知的应用归属与标题

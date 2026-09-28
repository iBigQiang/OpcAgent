# DEVLOG

开发日志：方案决策、实施细节、状态追踪。**最新的在最前面。**

分工：面向用户的版本变更写在 `CHANGELOG.md`；本文件记录「为什么这么做、怎么做的、还剩什么」。当前迭代的可核对清单在 `tasks/todo.md`，踩过的坑固化在 `tasks/lessons.md`。

---

## 2026-09-28 · CI 测试隔离与推送后构建文档自动更新

### 0.1.11 正式发布流程纠正

此前把“保留 main 默认分支”和“只能从 main 正式发布”混为一谈，导致 0.1.11 只完成验证制品与分支 README 写回，没有创建注解标签和公开 Release。正确边界是：GitHub Release 属于整个仓库，但其标签可以直接指向 `craft-sources-auto` 的提交；本次完整收尾不要求合并 main。目标分支推送并完成 CI、三平台验证构建和 README 写回后，应同步机器人提交，在该分支最新提交创建 `v0.1.11` 注解标签，再由 Release workflow 构建完整正式产物并发布 Latest。

当前版本一致性检查已通过，远端不存在 `v0.1.11` 标签或同名 Release。分支头验收提交包含 `[skip ci]`，直接以它触发 `push` 类型的标签工作流存在被跳过的风险，因此先提交本段流程纠正和 README 正式版本说明，使用不带跳过指令的新提交重新完成分支门禁，再在 README 写回后的最新提交上打标签。

GitHub run `36367008439` 在 quality 的完整测试阶段失败：`window-close-policy.test.ts` 注册了不含 `BrowserView` 的 Electron mock，后续 `browser-pane-manager.test.ts` 在同一 Bun 进程加载时无法取得该导出。邮件中的 Package skipped 是质量依赖失败的结果，并非未开启打包。原组合在本机复现为 2 pass / 1 fail / 1 error；把浏览器测试加入已有独立进程列表后，真实测试 runner 执行这两个文件共 80 pass / 176 assertions。没有删除断言、跳过测试或放宽门禁。

CI 继续监听 PR，以及 `main`、`craft-sources-auto` 的推送。三平台验证制品按源码 SHA 与 run attempt 命名，保留 30 天。全部打包成功后，独立 job 使用当前运行的真实制品 API 数据，在收到推送的分支 README 中写入有限范围的中文摘要及下载入口。仅该 job 获得仓库写权限；机器人只提交 README 和其 Craft 审计哈希，避免后续源码审计误报。默认分支仍为 main，不自动合并开发分支。

写回固定在经过验证的源码 SHA 上进行；如果分支已前进则跳过，不强推。PR、失败构建和不完整制品不得写入成功信息。机器人使用 GITHUB_TOKEN，不递归触发 push CI。手写 README 内容保留，版本摘要来自已有的中文内置版本说明；正式 Release 仍由人工准备的版本 tag 触发。配置只有进入某分支后才在该分支生效。

范围外审查发现：headless server 的独立分发可能漏带 Sharp 原生库，图片处理功能需另做隔离成品验证。本轮不改变产品运行时代码，也不把打包成功作为所有成品功能均已验证的证据。

本地 validate:ci、lint 和 Craft 审计通过；两份自动化脚本同进程运行 37 项测试、122 个断言及独立严格类型检查通过。Windows 全量首轮出现 51 项失败，其中两项是开发过程中的新测试夹具问题（非 ASCII HTTP 假令牌、临时空日志目录清理）并已修复；其余 49 个失败用例全部在固定 `ea4dbf1` 旧测试基线再次出现，CLI 超时异常也独立复现。基线共 4219 pass / 60 fail / 1 error，额外失败带有沙箱 EPERM 证据，因此只比较失败集合，不以不同运行条件的绝对数量判断回归。

对照还发现 `unified-network-interceptor.schema.test.ts` 硬编码 HOME 配置路径，与隔离的 CONFIG_DIR 不一致。现修正为使用拦截器同源模块常量，并在缺少预先设置的隔离环境时拒绝运行；原 20 项测试、45 个断言通过，验证前后真实配置哈希一致。Release 的 verify job 同步增加隔离目录注入，确保共用测试在正式发布流水线仍可运行。没有修改生产配置读写逻辑。

GitHub 第二轮 `36415666778` 已通过普通测试 4227 项、浏览器 CDP 19 项、浏览器管理 78 项及通知路由 2 项；后续分支回滚隔离测试暴露另一处旧夹具不匹配：消息仍使用 role 而不是持久化 type，且缺少新分支流程要求的 Pi 消息锚点，导致没进入预期的 SDK 预热失败路径。修正只补有效夹具，保留原错误、agent 销毁及子会话删除断言；目标与相邻分支回归 12 项、32 个断言通过。后续隔离测试逐文件执行共 68 pass / 2 fail，两个失败均为已知 Windows 路径断言；渠道真实入口与固定自动化绑定均通过，HTTP 请求只发往本地模拟端点。未复现测试入口的预加载冻结，不为静态猜测增加启动配置。Linux 全流程与实际三平台打包继续核对。

最终 [GitHub run 36416806387](https://github.com/iBigQiang/OpcAgent/actions/runs/36416806387) 的 quality、macOS arm64、Windows x64、Linux x64 及 README 写回五个作业全部成功，验证源码为 `46ce629b9662750c1c58dc65338a50e4bddc207f`。完整测试合计 **4395 pass / 11 skip / 0 fail**（不重复计入 validate:ci 的聚焦测试）。真实制品分别为 macOS `10967852728`、Windows `10967443111`、Linux `10967722327`，均为本轮未过期制品，保留至 2026-10-28。

机器人提交 `40b89016fbc200a8bcfb4f68b00a7a708ca3d62e` 仅更新 README 和其审计哈希，实际 README 含三个真实下载链接及中文摘要；未产生递归 CI。该提交已通过 `git pull --ff-only` 同步到本地。仓库默认分支仍为 main，当前流程部署在 craft-sources-auto；没有自动合并到 main、打 tag 或发布新的正式 Release。后续合并到 main 后主分支会采用同一流程。

收尾证据提交只更改文档和相应审计哈希，使用 `[skip ci]` 避免为同一已验证源码重复生成安装包；后续正常代码推送继续执行完整流程。Windows 平台旧测试差异和前述 headless Sharp 分发问题仍是单独事项，不能用本次 Linux CI 通过替代相应平台的功能验证。

---

## 2026-09-28 · Pi 会话跨渠道续聊与 0.1.11 收尾

完整需求、设计、修改清单及验收矩阵见 `tasks/goal-session-channel-model-switching.md`。渠道和模型现由 SessionManager 作为单次事务提交，Pi 执行实例按目标连接重建，沿用原 SDK 日志、分支切点、压缩摘要和授权工具。自动化定义及调度代码未变，明确保存的任务绑定不会被普通聊天或默认模型变更覆盖。Pi 与 Claude CLI 迁移仍留待下一阶段。

首阶段七组聚焦测试共 142 项、719 个断言通过。收尾另修复既有分支测试的持久化字段及 Windows 路径夹具，增加缺少指定锚点时不创建分支的验证，相邻 27 项、69 个断言通过。剩余 13 个 Craft 审计路径已逐项追溯原提交后登记，没有通过全量重算掩盖未审查差异。

Windows 打包准备时发现启动环境只查 app/vendor 下的 Bun，与 resources/vendor 的标准布局不一致。现在复用既有运行时解析器，和会话实例使用同一定位规则；不改变正常会话的引擎与渠道逻辑。7 项相关测试、12 个断言及 shared/Electron 类型检查通过。

真实 DeepSeek → Gemini → DeepSeek 续聊、两次只读会话工具调用及服务重启已通过；只使用合成测试口令和隔离会话。OpenCode Go、Kimi Code 的先行请求均返回订阅权限不足，没有改动其配置。实际凭据副本已删除，最终验证原配置和凭据文件哈希不变。首次准备脚本曾在 Bun preload 后才设 CONFIG_DIR，导致两条测试 Key 按读取值写回原加密库；已如实告知用户，后续改为启动进程前注入隔离目录并核对已加载常量，禁止隔离检查未通过时访问凭据。发布验收不能忽略 preload 的加载顺序。

0.1.11 沿用本地已有 Bun 1.3.9 和 uv 0.10.6，版本准备只改变 workspace 版本，锁文件无依赖升级。安装包写入独立 `apps/electron/release/v0.1.11`，保留旧版本。中文说明同时内置于应用资源。本次用户授权本地打包及推送当前 GitHub 分支，不创建公开 Release 或替换 Latest；最终桌面验收、校验和与推送结果继续记录在 Goal 文档。

---

## 2026-08-26 · 上游 MkAgent 增量比对与 dialog 回退链融合（基于 v0.1.10，未发版）

### 背景

OPC Agent 由上游 `MkThingsHQ/mkagent` 二开而来，需要定期确认上游有无值得吸收的更新，同时**不能让品牌、图标、通知、Sources/MCP 等二开成果被回退**。本轮只做只读比对 + 一处最小融合。

完整比对报告落在 `docs/开发及迭代方案调研报告/2026-08-26-上游mkagent增量比对报告.md`。

### 比对过程中差点造成误判的一件事

首次 `git fetch upstream --tags` **退出码 0、无输出**，此时 `merge-base HEAD upstream/main` 恰好等于 `upstream/main`，表面结论是「上游零更新」。实际是沙箱阻断了网络且**失败是静默的**，`upstream/main` 用的是 14 天前的缓存 —— `FETCH_HEAD` 的 mtime 停在 `08-12`，而当天是 `08-26`。

改用 `git ls-remote upstream refs/heads/main` 直连查询才拿到权威 SHA：上游是 `242306a`，本地缓存是 `8b660e0`，**上游实际有 3 个提交**。另外发现 `FETCH_HEAD` 在共享 `.git` 的 worktree 下会被并发会话覆写（`cat` 与 `git log` 两个读数互相矛盾），不可作判据。已固化为 `tasks/lessons.md` 的 L10。

### 上游增量的判定

3 个提交 / 5 个文件 / +597 行，其中**只有 1 处触及运行时代码**：

| 上游提交 | 性质 | 判定 |
|---|---|---|
| `2c22a07` dialog 桥接对齐 Craft | 运行时代码 | **部分融合**（只取窗口回退链） |
| `2b8b858` 新增 `README.zh.md` | 上游品牌文档 | 跳过 |
| `242306a` 新增 `docs/architecture.html` | 上游品牌资产 | 跳过 |

两个文档提交跳过的理由：我方已有完整 `docs/zh/`（20 个文件），覆盖面远超上游那个单文件 README；`architecture.html` 画的是上游 Lite 边界，与我方含 Sources/MCP 的架构已有实质差异，且两者都会带回 MkAgent 品牌字样。

`2c22a07` 拆开看是**两个独立变更**，只有一半对我们有价值：

- **窗口回退链** —— 我方确实缺。原写法 `BrowserWindow.fromWebContents(event.sender)!` 用非空断言掩盖了返回 `null` 的可能，此时 `dialog.showMessageBox(null, spec)` 会抛错、对话框不显示。
- **返回值收窄**（`showOpenDialog` 由返回数组改为 `{canceled, filePaths}`）—— **我方已在 `dd078875`（08-11）独立修过**，改成返回完整 Electron result，结构上已满足 `packages/server-core/src/transport/capabilities.ts` 声明的 `Promise<{canceled: boolean; filePaths: string[]}>` 契约。上游这半段是整洁度改进而非 bug 修复，零收益，不取。

### 缺陷真实触发面的核查

没有照抄上游 commit message 的口径。查证结果：注册 dialog capability 的 `bootstrap-preload.cjs`（`apps/electron/src/preload/bootstrap.ts:39-40`）只挂载在 `window-manager.ts:258` 的正规 BrowserWindow 上；Browser pane 用的是独立的 `browser-toolbar-preload.cjs`（`browser-pane-manager.ts:449`），**不注册 dialog**。

所以不存在「从 BrowserView/webview 发起 dialog」这条高频路径，真实触发面收窄为：**窗口正在销毁 / 已销毁，而 agent 侧的 dialog IPC 仍在飞行中的竞态**。低频但真实，改动极小且正常路径行为完全不变，值得补。

### 实施

`apps/electron/src/main/index.ts`：抽出模块级 `resolveDialogParent()`（两个 handler 共用，避免重复），用 `??` 三级回退取代非空断言。

保留我方现有返回值形状，只替换窗口解析表达式。额外处理了上游没管的边界：`getAllWindows()[0]` 在全部窗口关闭时是 `undefined`，此时显式走 `dialog.showMessageBox(options)` 单参重载，而不是依赖 Electron 对 falsy 首参的内部嗅探。

`scripts/craft-source-overrides.json`：用 `scripts/audit-craft-reuse.ts` 里 `fileSha256()` 的同一套逻辑（含 CRLF 归一为 LF）自算新 sha，**未抄上游的 sha 值** —— 我方该文件含二开内容，sha 必然不同。reason 在保留我方品牌表述的前提下追加了 dialog 说明。

一个坑：该文件里多个条目共用同一句 reason 描述，按 reason 文本全局替换会打到别的条目上，靠 `assert count == 1` 才拦下；正确做法是定位唯一的 sha256、再改其紧邻的下一行。已固化为 L11。

### 验证

- `typecheck:all` 退出码 0（另单独确认 electron 包被检查，非 `&&` 链提前短路）
- `lint` 退出码 0，含 `lint:craft-ui-sync` + `lint:craft-test-coverage`（72 个 warning 全为既有，0 error）
- `validate:ci` 退出码 0
- `audit:craft-reuse` **与改动前基线逐行一致**。该脚本是纯只读检查（无 `writeFileSync`，唯一参数 `--json`），不会自动写回清单；基线本身已有 18 项既有漂移（`notifications.ts`、`bun.lock`、`package.json`、`release-notes/0.1.10.md`、`docs/DEVLOG.md`、`tasks/*` 等），与本次改动无关。判定方式是**改动前后的漂移集合 diff**，不是绝对数字（L7）。
- 回退链四条分支路径逐一验证：发起方存活 / 回退聚焦窗口 / 回退首个存活窗口 / 全窗口关闭走单参重载，另加一组对照复现原缺陷（旧写法在第二种场景得到 `null`）。

### 遗留

**`resolveDialogParent` 没有仓库内单测。** 它是 `index.ts` 内的模块级函数且未导出，而 import `index.ts` 会触发主进程副作用，无法直接单测 —— 本项目可测逻辑的既有模式是抽独立模块（如 `deep-link.ts` 之于 `deep-link-routing.test.ts`）。本轮按「最小方案」交付，上面的分支验证是逻辑复刻而非仓库内回归测试，**未来若有人把回退链改回 `!` 断言，没有测试拦得住**。

若要补齐：把 `resolveDialogParent` 抽到独立模块并导出，新增 `__tests__` 用例，同时把新文件登记进 `craft-source-overrides.json` 的 `mkOnly` 段。

另注：`check-i18n-parity.ts` 报告 `1 locales, 1530 keys each`，而 `CLAUDE.md` 铁律第 4 条描述的是 `en.json` 与 `zh-Hans.json` 双 locale。与本次改动无关（本轮未动任何文案），但值得单独查一次。

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

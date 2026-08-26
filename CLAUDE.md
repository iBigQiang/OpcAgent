# CLAUDE.md — OPC Agent

给 AI 编码助手的项目约定速查。完整背景在 `docs/`，这里只放**动手改代码前必须先知道、否则会踩坑**的部分。

## 项目定位

本地优先的 Pi 驱动 AI Agent 工作空间。同一套运行时、同一套带鉴权的 WebSocket RPC 协议，服务三个客户端：Electron 桌面端、WebUI（浏览器）、CLI。用户数据默认落在 `~/.opcagent`；API Key 与 token 存在 AES-256-GCM 加密的本地凭据库里，**不写进配置文件或会话文件**。

| 想了解 | 看这里 |
|---|---|
| 分层拓扑、各包职责、backend 注册表 | `docs/architecture.md` |
| 环境要求、完整命令表、`CONFIG_DIR` 隔离 | `docs/development.md` |
| 发布流程、签名、自动更新 | `docs/releases.md` |
| 连接/权限/会话/Sources 等专题 | `docs/*.md` |
| 中文文档镜像 | `docs/zh/` |

## 仓库布局

```text
apps/electron/   Electron 桌面端（main / preload / renderer / Browser pane）
apps/webui/      通过浏览器适配器加载同一套 renderer
apps/cli/        RPC 命令行客户端
packages/core/                稳定 DTO、AgentEvent、错误码
packages/shared/              配置、凭据、prompts、Skills、主题、i18n、backend 注册表
packages/ui/                  React 基础组件、markdown/代码/文档渲染器
packages/server-core/         传输层、RPC handlers、SessionManager、runtime
packages/server/              headless 服务（OPCAGENT_SERVER_TOKEN）
packages/pi-agent-server/     Pi SDK 子进程（Bun，stdio 上跑 JSONL）
packages/session-tools-core/  会话级工具（plan / Skill / mini LLM / browser 等）
scripts/                      开发、构建、lint、审计脚本
```

`apps/online-docs` 故意排除在 workspace 之外。

## 铁律

### 1. 只用 Bun

`bun.lock` 是唯一事实来源，**不要执行 `npm install` / `pnpm install` / `yarn`**。`.gitignore` 已屏蔽 `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.pnpm-store/`（曾误跑 pnpm 留下过残留）。

- 装依赖：`bun install --frozen-lockfile`
- 加/升依赖：改对应 `package.json` → `bun install` 刷新 `bun.lock` → 再跑一次 `--frozen-lockfile` 确认解析可复现

**误跑过 pnpm 的话，删仓库里那几个文件远远不够。** 真正的破坏在 `node_modules` 内部：pnpm 会建 `node_modules/.pnpm/` 存储层、写 `node_modules/.modules.yaml`，并把一批顶层包（`react`、`typescript`、`tiptap-markdown` 等）换成指向 `.pnpm/` 的软链。于是同一个包存在两份副本 —— 一份 bun 装的真实目录，一份 pnpm 的 —— TypeScript 视为两个互不相关的类型，报出 `Two different types with this name exist, but they are unrelated` 这类完全看不出根因的错。自检与修复：

```bash
# 自检：三项都应为「不存在 / 0」
ls -d node_modules/.pnpm node_modules/.modules.yaml 2>/dev/null
find node_modules -maxdepth 2 -type l | while read l; do readlink "$l"; done | grep -c '\.pnpm'

# 修复：整体重装。不要手工挑软链，也不要只删 .pnpm/（会断掉 30 个包）
mv node_modules ../node_modules-tainted && bun install   # 先重命名而非删除，装不回来能立刻还原
```

重装后 `node_modules` 顶层只应剩 workspace 包（`@opcagent/*`）是软链，其余全是真实目录；同一个包也只应有一份 `package.json`。

**依赖一律钉确切版本，不写 `"latest"`。** `latest` 与 `--frozen-lockfile` 天然互斥 —— 上游每发一版，README 与 CI 里的 `bun install --frozen-lockfile` 就以 `lockfile had changes, but lockfile is frozen` 失败。更隐蔽的危害是它让同一个包在不同 workspace 包里锁到**不同版本**：本仓库曾出现 root 锁 `@types/bun@1.3.6`、`apps/cli` 锁 `1.4.0`，`bun.lock` 里为此多出一组 `@opcagent/cli/@types/bun` override 记录，两份类型声明并存 —— 与上面 pnpm 造成的 `@tiptap/core` 双份是同类隐患。`@types/bun` 现钉在 `1.3.14`，与 bun 运行时版本对齐；升 bun 时同步升它。

### 2. 只有 `pi` 一个 agent backend

自定义端点（`openai-completions`、`anthropic-messages`、Gemini）和 Ollama 都是**连接变体**，经 Pi 执行，不是独立 backend。加新模型/新供应商时走连接配置，别在 backend 注册表里加分支。

### 3. 自定义 eslint 规则是硬约束

这些规则各自对应一次真实事故，报错时**按提示改，不要加 `eslint-disable`**：

| 规则 | 禁止 | 改用 |
|---|---|---|
| `no-localstorage` | `localStorage` | 基于文件的偏好存储 |
| `no-direct-platform-check` | 直接读 `navigator.platform` | 统一的平台判断工具 |
| `no-hardcoded-path-separator` | 路径操作里硬编码分隔符 | `path` 工具函数 |
| `no-hardcoded-z-index` | `zIndex` 字面量 | z-index token（如 `var(--z-floating-menu, 400)`）、Tailwind `z-*`、具名常量 |
| `no-nonstandard-shadows` | 内联 `boxShadow`、未批准的 shadow class | 已批准的 shadow 工具类（`shadow-minimal` / `shadow-modal-small` 等） |
| `no-direct-file-open` | `window.electronAPI.openFile()` | context 里的 `onOpenFile` |
| `no-direct-navigation-state` | 在 navigation event handler 之外调 `setSidebarMode` | 走 navigation event handler |
| `no-inline-source-auth-check` | 直接判断 `source.config.isAuthenticated` | `sources/storage.ts` 的 `isSourceUsable()`（直接判断会漏掉 `authType: "none"`，那种其实算已认证） |
| `no-direct-open-import` | `import 'open'` | utils 里的 `openUrl` |

规则实现在 `apps/electron/eslint-rules/` 和 `packages/shared/eslint-rules/`。

### 4. 改 UI 文案必须双语同步

`packages/shared/src/i18n/locales/` 下 `en.json` 与 `zh-Hans.json` 必须同时改，且保持排序。三道检查各管一件事：

- `lint:i18n:parity` — 两个 locale 的 key 是否对齐
- `lint:i18n:usage` — 代码里静态引用的 key 是否真的存在于 `en.json`（parity 查不出"两边都缺"）
- `lint:i18n:sorted` — 排序；用 `bun run sort-locales` 自动修

### 5. 改 renderer 要过 Craft 复用审计

`apps/electron/src/renderer` 相对上游 Craft 的偏离由 `scripts/craft-*.json` 里的 sha256 清单锁定。改了受管文件就得同步 manifest，否则 `lint:craft-ui-sync` / `lint:craft-test-coverage` 会挂。刷新审计报告：`bun run audit:craft-reuse`。

（该脚本在算 sha256 前会把 `\r\n` 归一为 `\n`，所以清单对行尾不敏感。）

### 6. 测试不许写 `$HOME`

配置根目录由 `CONFIG_DIR` 决定，在 `packages/shared/src/config/paths.ts` 模块加载时读一次，影响所有下游路径（workspaces、凭据、日志、工具图标）。测试必须显式注入该环境变量，不得在真实 `$HOME` 下建文件。

并行开发时也可用它隔离：`CONFIG_DIR=/tmp/opcagent-dev bun run server:dev:webui`

### 7. 行尾由 `.gitattributes` 决定

仓库内一律存 LF，工作区默认也是 LF。例外：`.cmd` / `.bat` / `.ps1` 用 CRLF。`apps/electron/resources/bin/` 下无扩展名的 `#!/bin/sh` 包装脚本**必须** LF —— 带 `\r` 会让 shebang 在 Linux/macOS 上解析失败（在 Windows 上打包这两个平台时曾踩过）。

不要手工调行尾。若 `git status` 出现一批 modified 但 `git diff` 为空，那是 stat 缓存过期，`git add -A` 重算哈希即可确认无实质改动。

## 命令速查

| 目的 | 命令 |
|---|---|
| 跑 Electron 开发态 | `bun run electron:dev` |
| 跑 headless 服务 + WebUI | `bun run server:dev:webui` |
| 全量单测 + 隔离测试（Windows 上有既有平台失败，见下） | `bun run test` |
| 类型检查（全部包） | `bun run typecheck:all` |
| lint（含 craft 审计 + 各包 eslint） | `bun run lint` |
| **提交前完整校验** | `bun run validate:ci` |

`validate:ci` = `typecheck:all` + `test:shared:all` + `test:doc-tools` + 三道 i18n 检查。改动涉及 renderer 或 UI 文案时，额外跑 `bun run lint`。

**在 Windows 本地跑全量 `bun run test` 必然有既有失败**（本机实测 4239 个测试里 46 个），因为 CI 的 `bun run test` 跑在 `ubuntu-latest`，而 `scripts/run-tests.ts` 没有平台过滤 —— 一批按 Unix 语义校准的断言（硬编码 `/` 分隔符、传 `'darwin'` 平台参数、SIGTERM、把 `C:\...` 插进模板字符串）在 Windows 上跑不过。所以：

- 本机判断改动是否安全，看 **`validate:ci`**（平台无关）
- 全量 `bun run test` 在 Windows 上只用于看「失败集合有没有变大」，别拿绝对数字当结论
- 要一份干净的全量结果，交给 CI

## 发布

`bun run release:prepare <version>` 生成版本提交，人工 review 后打注解 tag `v*` 触发 CI 多平台构建。发布前把用户可见改动写进 `CHANGELOG.md` 的 `[Unreleased]` 段（本项目 CHANGELOG 用中文撰写，遵循 Keep a Changelog + SemVer）。

## 迭代记录去哪写

- `CHANGELOG.md` — 面向用户的版本变更（中文，发布时整理）
- `docs/DEVLOG.md` — 面向开发的日志：方案决策、实施细节、状态追踪，最新版本置顶
- `tasks/todo.md` — 当前迭代的可核对任务清单 + 结果复盘
- `tasks/lessons.md` — 踩过的坑与固化的规则

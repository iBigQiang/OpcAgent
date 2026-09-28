<p align="center">
  <img src="./apps/electron/resources/icon.png" alt="OPC Agent" width="96" height="96" />
</p>

<h1 align="center">OPC Agent</h1>

<p align="center">
  A local-first, Pi-powered AI agent workspace for Desktop, WebUI, and CLI.
</p>

<p align="center">
  <a href="https://github.com/iBigQiang/OpcAgent/releases/latest"><img src="https://img.shields.io/github/v/release/iBigQiang/OpcAgent?label=release" alt="Latest release" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache License 2.0" /></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-1.3.14%2B-f9f1e1?logo=bun&amp;logoColor=000" alt="Bun 1.3.14 or later" /></a>
  <a href="https://www.electronjs.org"><img src="https://img.shields.io/badge/Electron-39-47848F?logo=electron&amp;logoColor=white" alt="Electron 39" /></a>
</p>

<p align="center">
  <a href="https://github.com/iBigQiang/OpcAgent/releases/latest">Download</a> ·
  <a href="./docs/README.md">Documentation</a> ·
  <a href="./docs/zh/README.md">中文文档</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="https://github.com/iBigQiang/OpcAgent/discussions">Community</a>
</p>
OPC Agent is an open-source AI agent workspace for people who want local control over their work,
model connections, and data. The same Pi-powered runtime serves the Electron desktop app, WebUI,
headless server, and CLI. It combines persistent workspaces and sessions with model flexibility,
Skills, browser and document tools, Sources, projects, automations, and optional messaging channels.

Application data stays under `~/.opcagent` by default. API keys and tokens are kept in a local
AES-256-GCM encrypted credential store rather than written into configuration or session files.

<!-- opcagent:ci-build:start -->
## 最新验证构建

源码版本：**0.1.11**；分支：`craft-sources-auto`；提交：[46ce629](https://github.com/iBigQiang/OpcAgent/commit/46ce629b9662750c1c58dc65338a50e4bddc207f)。

构建时间：2026-09-28T11:51:56.678Z；[CI #36416806387 · 第 1 次运行](https://github.com/iBigQiang/OpcAgent/actions/runs/36416806387/attempts/1)。

| 平台 | 验证构建下载 |
| --- | --- |
| Windows x64 | [下载 Artifact](https://github.com/iBigQiang/OpcAgent/actions/runs/36416806387/artifacts/10967443111) |
| macOS Apple Silicon | [下载 Artifact](https://github.com/iBigQiang/OpcAgent/actions/runs/36416806387/artifacts/10967852728) |
| Linux x64 | [下载 Artifact](https://github.com/iBigQiang/OpcAgent/actions/runs/36416806387/artifacts/10967722327) |

本版用户改动：

- 新建及已有 Pi 会话支持在不同渠道和模型之间切换，沿用原会话上下文、压缩摘要、历史工具结果和已启用工具。
- 渠道与模型作为一次完整选择保存，支持跨窗口同步；原渠道删除后可选择其他有效 Pi 渠道继续对话。
- 会话执行中暂停模型切换；切换失败保留原选择和输入草稿，重启后恢复已保存的渠道与模型。
- 自动化定时任务继续使用任务中保存的渠道与模型，聊天选择和默认模型调整不会改变任务绑定。
- 修复部分助手回复缺少 Pi 分支切点，以及 Windows 工作区路径重复转换导致分支持久化位置错误的问题。

下载 Artifact 需要登录 GitHub。Artifact 保留期为 **30 天**，到期后下载链接可能失效。此处为 CI 验证构建；正式版本及长期下载请查看 [GitHub Releases](https://github.com/iBigQiang/OpcAgent/releases/latest)。
<!-- opcagent:ci-build:end -->

## Current release

Version **0.1.10** completes the brand icon refresh that began in 0.1.9. Every icon surface —
installer, application window, system notifications, in-app logo, and WebUI favicon — is now
generated from a single 1024px source image. Installer and setup-wizard icons are redrawn into nine
sizes (16 through 256), so the wizard title bar and header graphic are no longer blurry, and Windows
completion toasts drop the redundant hero logo while keeping the small app icon in the title bar.

See the [changelog](./CHANGELOG.md) and [GitHub Releases](https://github.com/iBigQiang/OpcAgent/releases)
for complete release notes and downloads.

## Features

- **Local-first workspaces and sessions** — keep configuration, sessions, files, attachments, and
  workspace history on your machine; search, flag, archive, import, export, and branch sessions.
- **Flexible AI connections** — use ChatGPT Plus, Claude Pro/Max, provider API keys, AgentRouter,
  AnyRouter, Ollama, and custom OpenAI Chat, OpenAI Responses, Anthropic Messages, or Gemini endpoints.
- **Desktop, WebUI, and CLI** — use the full Electron application, connect a browser renderer to the
  headless server, or automate workflows through the RPC command-line client.
- **Agent workflows** — use plans, Skills, projects, scheduled or event automations, follow-ups, and
  multiple application windows.
- **Sources and tools** — connect API, MCP, or local-folder Sources; browse the web; work with
  attachments; render Markdown and code; and inspect or transform common document formats.
- **Messaging integrations** — connect Telegram, WhatsApp, or Lark / Feishu to workspace sessions,
  with pairing, owner access, allow lists, and workspace-scoped bindings.
- **Explicit control** — configure permission modes, thinking depth, network proxy settings, themes,
  input behavior, and English or Simplified Chinese interface language.
- **Persistent updates** — application upgrades preserve `~/.opcagent` configuration and history;
  interactive Windows uninstall lets the user choose whether to retain or remove that data.

## Downloads

Prebuilt Desktop packages are published on [GitHub Releases](https://github.com/iBigQiang/OpcAgent/releases/latest):

| Platform | Package | Trust note |
| --- | --- | --- |
| Windows x64 | NSIS installer: `OPC-Agent-<version>-x64.exe` | Unsigned builds may trigger Microsoft Defender SmartScreen |
| macOS Apple Silicon / Intel | DMG and ZIP | Ad-hoc builds may trigger Gatekeeper unless a signed release is available |
| Linux x64 | AppImage | Download, mark executable, and run |

Release pages also contain checksums, update manifests, headless-server archives, and the Bun CLI
bundle. Verify downloaded files against the published `SHA256SUMS` before installation.

## Quick start

### Prerequisites

- [Bun](https://bun.sh) 1.3.14 or later
- Node.js 18 or later
- Git
- Python 3.12 and [`uv`](https://docs.astral.sh/uv/) for the complete document-tool test suite

### Run the Desktop app from source

```bash
git clone https://github.com/iBigQiang/OpcAgent.git
cd OpcAgent
bun install --frozen-lockfile
bun run electron:dev
```

On Windows, install Git for Windows and configure the Git Bash path in OPC Agent if it is not found
automatically. The default application-data root is `%USERPROFILE%\.opcagent`; on macOS and Linux it
is `~/.opcagent`. Set `CONFIG_DIR` only when you intentionally need an isolated development or test
profile.

### Common commands

| Command | Description |
| --- | --- |
| `bun run electron:dev` | Start the Electron development environment |
| `bun run electron:start` | Build and launch Electron once |
| `bun run server:prod` | Build and start the headless server with WebUI |
| `bun run cli:build` | Build the CLI bundle |
| `bun run test` | Run unit and isolated tests |
| `bun run typecheck:all` | Type-check every workspace package and application |
| `bun run validate:ci` | Run the full type, test, document-tool, and localization gate |
| `bun run electron:dist:win` | Build the Windows installer locally |

More commands and environment variables are documented in the
[development guide](./docs/development.md).

## Architecture

OPC Agent is a Bun workspace with one RPC contract across its local interfaces:

```text
apps/
  electron/                    Electron main, preload, renderer, and browser pane
  webui/                       Browser adapter for the shared renderer
  cli/                         RPC command-line client
packages/
  core/                        Stable DTOs, events, and error contracts
  shared/                      Configuration, credentials, prompts, Sources, Skills, and i18n
  ui/                          Shared React UI and content renderers
  server-core/                 RPC transport, sessions, and runtime orchestration
  server/                      Headless server
  pi-agent-server/             Pi agent subprocess
  session-tools-core/          Plans, Skills, browser, and session tools
  messaging-gateway/           Telegram, WhatsApp, and Lark workspace routing
  messaging-whatsapp-worker/   Isolated WhatsApp worker
```

Read the [architecture guide](./docs/architecture.md) for runtime boundaries, process ownership, and
data flow.

## Documentation

The documentation is available in [English](./docs/README.md) and
[Simplified Chinese](./docs/zh/README.md).

| Area | Guides |
| --- | --- |
| Start here | [Development](./docs/development.md), [architecture](./docs/architecture.md), [testing](./docs/testing.md) |
| Models | [Connections](./docs/connections.md), [Ollama](./docs/ollama.md) |
| Data and work | [Data directory](./docs/data-directory.md), [workspaces](./docs/workspaces.md), [sessions](./docs/sessions.md), [Skills](./docs/skills.md) |
| Tools | [Browser](./docs/browser.md), [attachments](./docs/attachments.md), [document tools](./docs/document-tools.md) |
| Runtime | [CLI](./docs/cli.md), [permissions](./docs/permissions.md), [network proxy](./docs/network-proxy.md) |
| Project | [Features](./docs/featues.md), [releases](./docs/releases.md), [upstream synchronization](./docs/upstream-sync.md) |

## Contributing

Contributions are welcome. Create a focused branch, include tests and documentation with behavioral
changes, and run the relevant checks before opening a pull request. For the complete local gate:

```bash
bun run validate:ci
bun run audit:craft-reuse
git diff --check
```

Use [GitHub Issues](https://github.com/iBigQiang/OpcAgent/issues) for bugs and feature requests, and
[GitHub Discussions](https://github.com/iBigQiang/OpcAgent/discussions) for questions and ideas.

## Project lineage

OPC Agent derives from the [MkAgent](https://github.com/MkThingsHQ/mkagent) source lineage, which
includes [Craft Agents OSS](https://github.com/craft-ai-agents/craft-agents-oss) `v0.11.2`
(`a60ebc1a5a7c`). OPC Agent has an independent Git history and product boundary and is not affiliated
with or endorsed by the upstream projects or their trademark owners. See [NOTICE](./NOTICE) for
attribution and the [comparison guide](./docs/comparison-with-craft.md) for the current differences.

## License

Licensed under the [Apache License 2.0](./LICENSE). You may use, modify, and distribute the code,
including for commercial purposes, subject to the license terms and the attribution in
[NOTICE](./NOTICE).

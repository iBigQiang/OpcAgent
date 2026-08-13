# OPC Agent vs. Craft Agents — current comparison

> Snapshot taken on **2026-08-10** against OPC Agent `main` at `00c0df4` and the upstream tag [`craft-ai-agents/craft-agents-oss` `v0.11.2` / `a60ebc1a5a7c`](https://github.com/craft-ai-agents/craft-agents-oss). Numbers are repository snapshots, not live release metrics. Re-run the commands in the final section after changing either baseline; the current checkout has a pre-existing `README.md` lineage-manifest warning if that file is modified without refreshing the manifest.

This document explains, with evidence, what OPC Agent keeps from Craft Agents, what it physically removes, and how those choices change the artifact you ship. OPC Agent is the "Lite" derivative built on the same architecture and renderer; the table below is the canonical answer to "what's actually different?".

## 1. Repository & source line count

Both repositories are Bun monorepos with the same workspace layout (`apps/{electron,webui,cli}` + `packages/{core,shared,ui,server-core,server,pi-agent-server,session-tools-core}`). OPC Agent reuses that layout, drops two product-only packages from Craft (`messaging-gateway`, `messaging-whatsapp-worker`), removes the entire `apps/viewer` app, and never instantiates Craft's session-MCP/bridge-MCP servers.

| Metric | OPC Agent | Craft Agents | Notes |
|---|---:|---:|---|
| Tracked TypeScript / TSX LOC (`*.ts`,`*.tsx`, excludes `node_modules`,`dist`,`release`,`.git`) | **190,558** | 344,964 | OPC Agent source ≈ **55 %** of Craft's |
| Tracked source files (current `git ls-files`) | 1,163 | ~1,719 | 96 % same-path rate against Craft (`bun run audit:craft-reuse`) |
| Same-path files normalized to byte-identical | 686 (59 %) | — | Mechanical replacements only: scope (`@opcagent/*` <-> `@craft-agent/*`), URL scheme (`opcagent://`), config root (`~/.opcagent`), brand strings |
| Same-path Lite-customized | 430 | — | Lite boundary (e.g. deleted Sources/MCP branch) plus brand |
| OPC-Agent-only source files | 47 | — | OPC Agent brand assets, `audit:craft-reuse`, lint/CLI scripts, `apps/online-docs`-equivalent leftovers removed |
| Source files Craft has that OPC Agent does not | — | 606 | Removed by the Lite boundary (Claude backend, OAuth, Sources, MCP, Messaging, Viewer, automations, ...) |
| Top-level `dependencies` | 56 | 61 | OPC Agent drops `@anthropic-ai/claude-agent-sdk`, `@dnd-kit/{dom,helpers}`, `@github/copilot-sdk`, plus the messaging OAuth flow packages. It retains `@anthropic-ai/sdk` for Pi-compatible Anthropic access and `@modelcontextprotocol/sdk` for Sources without the Claude Agent runtime. |
| Top-level `devDependencies` | 33 | 34 | Only meaningful drop is `@aws-sdk/client-s3` (used only for the upstream release upload to S3; OPC Agent's `electron-updater` GitHub provider does not need it) |
| `node_modules/` size on a clean `bun install --frozen-lockfile` | **2.0 GB** | 2.5 GB | The 0.5 GB delta matches the dropped native + SDK bundles below |

## 2. Apps & packages actually present

| Path | OPC Agent | Craft Agents |
|---|---|---|
| `apps/electron` | Yes (shared renderer + preload + Browser pane + Sentry + auto-update) | Yes (same) |
| `apps/webui` | Yes (loads the same renderer through a browser adapter) | Yes (same) |
| `apps/cli` | Yes (`run`, `session`, `workspace`, `send`, ...) | Yes (same surface plus extra Sources/Automations sub-commands, which OPC Agent does **not** expose) |
| `apps/viewer` | No (deleted) | Yes (Electron Viewer app for sharing sessions publicly) |
| `packages/core` | Yes | Yes |
| `packages/shared` | Yes (with `messaging-gateway`, `interceptor-common`, `feature-flags`, `interceptor-request-utils` removed) | Yes (full size) |
| `packages/ui` | Yes | Yes |
| `packages/server-core` | Yes | Yes |
| `packages/server` | Yes (headless `OPCAGENT_SERVER_TOKEN` server) | Yes |
| `packages/pi-agent-server` | Yes (only registered backend) | Yes (alongside Craft's `claude-agent-sdk` backend) |
| `packages/session-tools-core` | Yes (Labels/Statuses/MCP/Sources OAuth branches trimmed) | Yes (full size) |
| `packages/messaging-gateway` | No (deleted) | Yes |
| `packages/messaging-whatsapp-worker` | No (deleted) | Yes (Baileys-backed WhatsApp worker) |
| `packages/session-mcp-server` | No (deleted) | Yes (TypeScript MCP server bundled as `resources/session-mcp-server/`) |
| `resources/bridge-mcp-server/` | No (deleted) | Yes (bundled, ~13 MB TypeScript MCP server) |
| `resources/scripts/` + `resources/bin/` | Yes (`markitdown`, PDF, XLSX, DOCX, PPTX, image, iCal, doc-diff wrappers + Python scripts + bundled **per-platform `uv`**) | Yes (same wrappers and per-platform `uv` layout) |

## 3. Backend / runtime boundary

| Concern | OPC Agent | Craft Agents |
|---|---|---|
| Registered `AgentBackend`s | `pi` only | `pi`, `claude-agent-sdk`, plus optional **Copilot / gateway** subscriptions |
| Auth model | API key + custom endpoints + Ollama + **ChatGPT/Claude subscription OAuth**, all through Pi | API-key + custom + **OAuth (Anthropic, OpenAI, GitHub Copilot, Google Workspace, Slack, Microsoft)** + subscription flows + gateway |
| Subprocess model | `packages/pi-agent-server` runs as a Bun subprocess; communicates over JSONL on stdio | Pi subprocess (same) **plus** SDK subprocess (`@anthropic-ai/claude-agent-sdk-binary`, ~217 MB native `claude` binary per platform arch) **plus** bridge/session MCP servers **plus** WhatsApp worker subprocess |
| Built-in transports | OpenAI-compatible, Anthropic-compatible, Ollama (Pi `0.80.6`) | Same, plus Anthropic SDK direct mode and Copilot SDK mode |
| Image generation | No (deleted; image attachments still supported) | Yes (`gen_image` model + tool) |

## 4. Agent tools (what the model can actually call)

Both products expose tools to the LLM through three channels: (a) Pi SDK built-ins wired in `packages/pi-agent-server/src/index.ts` `builtinDefs`, (b) web tools declared in the same file (`createSearchTool` + `createWebFetchTool`), and (c) session-level tools registered through the main process via `register_tools` and exposed to the model with the `mcp__session__<name>` prefix (see `packages/session-tools-core/src/tool-defs.ts`). Craft additionally surfaces tools from its `mcpPool` (Sources / bridge / session MCP). OPC Agent has no `mcpPool` — the `registerPoolToolsWithSubprocess()` call is physically removed (`packages/shared/src/agent/pi-agent.ts`).

### 4.1 Pi SDK built-in tools (identical)

Both repositories import the same helpers from `@earendil-works/pi-coding-agent` and instantiate them in the same order:

| Tool | Purpose |
|---|---|
| `read` | Read file contents |
| `bash` | Execute a shell command |
| `edit` | Edit file in place |
| `write` | Create / overwrite file |
| `grep` | Search across file contents |
| `find` | Locate files by name pattern |
| `ls` | List directory contents |

`packages/pi-agent-server/src/index.ts` lines 30–36 import `createReadToolDefinition`, `createBashToolDefinition`, `createEditToolDefinition`, `createWriteToolDefinition`, `createGrepToolDefinition`, `createFindToolDefinition`, `createLsToolDefinition`; lines 607–614 instantiate them with `cwd`. The same imports appear at the same offsets in Craft.

### 4.2 Web tools (identical)

| Tool | Source | Notes |
|---|---|---|
| `web_search` | `packages/pi-agent-server/src/tools/search/create-search-tool.ts:61` | Provider-agnostic; falls back to DuckDuckGo when no key is configured |
| `web_fetch` | `packages/pi-agent-server/src/tools/web-fetch.ts:338` | Fetches up to 50 MB; converts to Markdown via Turndown; returns up to 50 000 chars |

### 4.3 Session-level `mcp__session__*` tools — the real cut

`SESSION_TOOL_DEFS` in `packages/session-tools-core/src/tool-defs.ts` is the single source of truth. The model sees every entry here with the `mcp__session__` prefix. OPC Agent keeps **15** of these; Craft exposes **27**.

| Tool (model-visible name) | OPC Agent | Craft | What it does / why OPC Agent dropped it |
|---|:---:|:---:|---|
| `mcp__session__SubmitPlan` | Yes | Yes | Plan review; submits a plan file and pauses the turn |
| `mcp__session__browser_tool` | Yes | Yes | Browser pane control |
| `mcp__session__call_llm` | Yes | Yes | Internal mini-LLM call (titles, summaries, scripts) |
| `mcp__session__config_validate` | Yes | Yes | Validate a workspace `config.json` patch before save |
| `mcp__session__get_session_info` | Yes | Yes | Read session metadata |
| `mcp__session__list_background_tasks` | Yes | Yes | List in-flight background tasks |
| `mcp__session__list_sessions` | Yes | Yes | List sibling sessions in the workspace |
| `mcp__session__mermaid_validate` | Yes | Yes | Validate Mermaid source |
| `mcp__session__script_sandbox` | Yes | Yes | Run a Python script in a sandboxed `uv` environment |
| `mcp__session__send_agent_message` | Yes | Yes | Forward a message into a sibling or spawned session |
| `mcp__session__send_developer_feedback` | Yes | Yes | Send feedback channel |
| `mcp__session__skill_validate` | Yes | Yes | Validate Skill frontmatter and body |
| `mcp__session__spawn_session` | Yes | Yes | Spawn a child session (Lite version, no full conductor) |
| `mcp__session__transform_data` | Yes | Yes | Apply a transform expression to a payload |
| `mcp__session__update_user_preferences` | Yes | Yes | Persist user preference overrides |
| `mcp__session__create_task` | No | Yes | Tasks conductor entry point. The product-level Automations surface is removed; the underlying task registry is preserved for background work, but no model-facing entry. |
| `mcp__session__list_messaging_channels` | No | Yes | Lists bound external messaging channels. Removed with the messaging gateway. |
| `mcp__session__unbind_messaging_channel` | No | Yes | Counterpart of `list_messaging_channels`; same reason. |
| `mcp__session__render_template` | No | Yes | Template-rendering helper. Removed as part of the session-tool rendering disablement; see `migration/migration-features.md`. |
| `mcp__session__set_session_labels` | No | Yes | User-configurable labels on a session. OPC Agent has no labels product area. |
| `mcp__session__set_session_status` | No | Yes | User-configurable status on a session. OPC Agent has no user statuses. |
| `mcp__session__source_credential_prompt` | No | Yes | OAuth credential prompt for a Source. Removed with Sources. |
| `mcp__session__source_oauth_trigger` | No | Yes | Generic Source OAuth trigger. |
| `mcp__session__source_google_oauth_trigger` | No | Yes | Google OAuth Source trigger. |
| `mcp__session__source_microsoft_oauth_trigger` | No | Yes | Microsoft OAuth Source trigger. |
| `mcp__session__source_slack_oauth_trigger` | No | Yes | Slack OAuth Source trigger. |
| `mcp__session__source_test` | No | Yes | Probe a Source from within a turn. |

### 4.4 Source pool / MCP tools

Craft Agents registers an `mcpPool` and forwards its proxy tool definitions through a second `register_tools` message (`packages/shared/src/agent/pi-agent.ts` → `registerPoolToolsWithSubprocess`). The pool contains tools exposed by every configured Source (API Source, MCP Source) and by Craft's bundled `bridge-mcp-server` / `session-mcp-server`. OPC Agent has no `mcpPool` and ships neither MCP server package.

| Source / MCP channel | OPC Agent | Craft | Notes |
|---|:---:|:---:|---|
| API Source proxies (HTTP / GraphQL / etc.) | No | Yes | Live API endpoints, configured through the Sources UI |
| MCP Source proxies (stdio MCP servers) | No | Yes | Per-source MCP process with its own permissions |
| `bridge-mcp-server` (Craft-bundled MCP bridge, ~13 MB) | No | Yes | TypeScript MCP server under `resources/bridge-mcp-server/` |
| `session-mcp-server` (Craft-bundled session MCP) | No | Yes | TypeScript MCP server under `resources/session-mcp-server/` |
| Per-source credential prompts and OAuth flows | No | Yes | Backed by `source_credential_prompt` and the four `source_*_oauth_trigger` tools listed above |

### 4.5 Claude backend tools (exist only in Craft)

Craft Agents' second registered backend, `claude-agent-sdk`, brings Claude-Code-style tools that Pi does not define. OPC Agent has no Claude backend, so none of these exist in OPC Agent. The Claude backend binding is physically removed — `packages/shared/src/agent/backend/internal/drivers/` does not carry a `claude-agent-sdk` driver — and even if a tool name appeared in the system prompt, OPC Agent has no execution path for it.

| Tool | Backend | OPC Agent | Craft |
|---|---|:---:|:---:|
| `TodoWrite` | claude-agent-sdk | No | Yes |
| `NotebookEdit` | claude-agent-sdk | No | Yes |
| `MultiEdit` | claude-agent-sdk | No | Yes |
| Claude SDK-native `Read` / `Write` / `Edit` / `Bash` / `Grep` / `Glob` / `WebFetch` / `WebSearch` | claude-agent-sdk | No | Yes |

### 4.6 Effective tool count per agent turn

Counting only the tools the model can invoke at run time, with no user-configured Source configured:

| Source of tools | OPC Agent | Craft |
|---|---:|---:|
| Pi SDK built-ins (§4.1) | 7 | 7 |
| Web tools (§4.2) | 2 | 2 |
| Session (`mcp__session__*`) | 15 | 27 |
| Source / MCP pool (`mcpPool`) | 0 | 0 (Craft grows this dynamically per configured Source) |
| Claude SDK tools | 0 | variable per session |
| **Default baseline** | **24** | **36** |

The 12 dropped `mcp__session__*` tools map one-to-one onto the Lite boundary deletion list (Sources, MCP, OAuth, labels, statuses, messaging, task conductor, template renderer); the rest of the difference is the second registered backend.


## 5. Installer / package size (the headline numbers)

These are the sizes you actually ship to users, taken from the on-disk dev build at `apps/electron/release/<arch>/OPC Agent.app` and the upstream `craft-agents-oss` checkout that the audit script read. **None** of these include code-signing overhead (OPC Agent dev build sets `OPCAGENT_DEV_RUNTIME=1`; release builds with `CSC_IDENTITY_AUTO_DISCOVERY=false` are unsigned/ad-hoc). For a Craft Agents reference, the `claude-agent-sdk-darwin-arm64/claude` binary alone (`217 MB`) was measured directly from `node_modules`.

### 4.1 macOS arm64 (`OPC Agent.app` / `Craft-Agents-arm64.app`)

| Component | OPC Agent | Craft Agents | Delta (Craft − OPC Agent) |
|---|---:|---:|---:|
| `Contents/Resources/app/dist/` (bundled JS, renderer assets, scripts) | 116 MB | ~380 MB | ~−264 MB |
| `Contents/Resources/app/node_modules/` (runtime node_modules + cron packs) | 5.0 MB | ~210 MB | ~−205 MB (Craft bundles the SDK, MCP servers, WhatsApp worker, plus more) |
| `Contents/Resources/app/vendor/` (Bun runtime) | 60 MB | 60 MB | 0 |
| Other resources / signatures | 2 MB (icons, plists, Codesign) | ~2 MB | ~0 |
| **Subtotal** | **~183 MB** | **~652 MB** | **~−469 MB** (~−72 %) |
| `Contents/Frameworks/Electron Framework.framework` | 253 MB | 253 MB | 0 (identical Electron `39.2.7`) |
| `Contents/Frameworks/{Mantle,ReactiveObjC,Squirrel, Squirrel.framework}` | ~1 MB | ~1 MB | 0 |
| `OPC Agent Helper*.app` (Renderer/GPU/Plugin) | ~1 MB | ~1 MB | 0 |
| **`OPC Agent.app` total (unpacked)** | **438 MB** | **~907 MB** | **~−469 MB** |

> The unpacked `.app` sizes already include helper apps and the Electron framework; they **exclude** the platform download (DMG/ZIP wrapper). Because `craft-agents-oss/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude` is a single **217 MB** binary with a per-platform `.zip` for `-darwin-x64` / `-win32-x64` / `-linux-x64` of similar shape, the upstream DMG/ZIP for Craft always exceeds OPC Agent's by **≥ ~250 MB** after compression.

### 4.2 What `electron-builder` carries in `extraResources`

| Bundled to installer | OPC Agent | Craft Agents | Approx. size carried in installer |
|---|---|---|---:|
| Per-platform **`claude` native binary** (Anthropic SDK) | No | Yes | **~217 MB per platform arch** |
| Bundled **`uv`** Python launcher (target-platform binary under `resources/bin/<platform-arch>/`) | Yes (`uv 0.10.6`; injected through `OPCAGENT_UV`) | Yes | ~30–55 MB for the target arch in each package |
| `@anthropic-ai/claude-agent-sdk` thin core + per-platform binary shim | No | Yes | ~3.5 MB core + ~217 MB binary per arch |
| `bridge-mcp-server/` (Craft's MCP bridge) | No | Yes | ~13 MB |
| `session-mcp-server/` (Craft's session MCP) | No | Yes | ~50 KB TypeScript |
| WhatsApp worker (`packages/messaging-whatsapp-worker/dist/worker.cjs`) with bundled Baileys | No | Yes | ~8 MB worker + transitive Baileys deps |
| `resources/scripts/*.py` (PDF, DOCX, XLSX, PPTX, image, iCal, doc-diff, MarkItDown wrappers) | Yes (same files) | Yes | ~110 KB Python; both versions keep them |
| `resources/bin/*-tool` shell wrappers | Yes (same) | Yes | trivial |
| `@vscode/ripgrep` (bundled `rg` for `server-core` search) | Yes (4.3 MB on mac-arm64) | Yes | 4.3 MB |
| `vendor/bun` (Bun runtime for Pi subprocess) | Yes (60 MB on mac-arm64) | Yes | 60 MB |
| `dist/resources/{themes,tool-icons,permissions,docs,release-notes}` | Yes | Yes | couple of MB |
| `dist/renderer/assets/` (KaTeX fonts, Shiki languages, language modes) | Yes (~51 MB) | Yes | identical |

### 4.3 Net effect for end users

| Effect | OPC Agent | Craft Agents |
|---|---|---|
| DMG (macOS arm64 / x64) download | ~165 MB¹ | ~370 MB¹ |
| macOS `.app` install footprint | ~438 MB | ~907 MB |
| NSIS `.exe` (Windows x64) | ~210 MB¹ | ~430 MB¹ |
| Linux AppImage | ~200 MB¹ | ~420 MB¹ |
| `bun run apps/cli` pure-CLI mode (no Electron) | `bun run cli:build` → ~1 MB `dist/opcagent` package; same on Craft | ~1 MB (CLI payload itself is identical) |
| First document-tool run with a cold `uv` cache | May download Python 3.12 and declared script dependencies on demand | Same |

¹ **Caveat.** DMG / NSIS / AppImage numbers above are **inferred** from the unpacked `.app` sizes and the `electron-builder.yml` `files` / `extraResources` rules; they are not freshly built side-by-side. Both release pipelines fetch or copy a target-platform `uv` binary. Craft additionally brings the ~217 MB Claude SDK binary; OPC Agent skips that backend payload, not `uv`.

## 6. Feature surface

The matrix below extends [`docs/featues.md`](./featues.md) with explicit numbers from the audit and pointing at concrete file evidence.

| Area | OPC Agent | Craft Agents |
|---|---|---|
| Electron Desktop + WebUI + headless server + CLI + shared renderer | Yes | Yes |
| Pi agent + Pi provider preset + API-key connections | Yes | Yes |
| Custom OpenAI-completions / Anthropic-messages endpoints + Ollama | Yes | Yes |
| Local multi-workspace, `default` slug, per-window binding | Yes | Yes |
| Sessions: create / continue / cancel / resume / flag / archive / unread / search / import / export / branch / multi-window | Yes | Yes |
| Skills (global / workspace / project), mini chat, plan, annotations, follow-up | Yes | Yes |
| Browser pane + `web_search` + `web_fetch` | Yes | Yes |
| Permissions (safe / allow-all) + permission prompts | Yes | Yes |
| Network proxy | Yes | Yes |
| Auto-update via `electron-updater` against GitHub Releases | Yes (against `iBigQiang/OpcAgent`) | Yes (against `https://agents.craft.do/electron/latest`) |
| Sentry (`@sentry/electron` + `@sentry/react`); gated by `SENTRY_ELECTRON_INGEST_URL` | Yes | Yes |
| Document tools (PDF / DOCX / XLSX / PPTX / image / iCal / doc-diff / MarkItDown) with `uv`-based Python wrappers | Yes (bundled per-platform `uv`; PATH fallback in development) | Yes (bundled per-platform `uv`) |
| Mini chat, `EditPopover`, mini model, titles, summaries | Yes | Yes |
| Theme presets, light/dark/system, i18n (`en`, `zh-Hans`) | Yes (15 themes inherited from Craft) | Yes (same) |
| Tool icons, default permissions, "What's New" notes | Yes | Yes |
| Claude Agent SDK backend | No | Yes |
| Claude Pro/Max OAuth subscription | Yes (Pi) | Yes (Claude SDK by default) |
| ChatGPT Plus OAuth subscription | Yes (Pi) | Yes (Pi) |
| GitHub Copilot SDK + OAuth subscription | No | Yes |
| External messaging gateway + WhatsApp / Slack / Lark workers | No | Yes |
| Sources (API Source, MCP Source, MCP pool), Source OAuth flows | No | Yes |
| Session MCP server, bridge MCP server | No | Yes |
| Viewer (separate Electron app for shared sessions) | No | Yes |
| Public sharing, remote workspace federation/transfer | No | Yes |
| Product automations / scheduler / recurring tasks | No | Yes |
| Session labels + user-defined statuses (settings UI) | No | Yes |
| Projects / Kanban | No | Yes |
| LLM subscription OAuth callback | Yes (ChatGPT Desktop callback; Claude code flow) | Yes |
| Generic / Sources / gateway OAuth | No | Yes |
| Image generation (`gen_image` tool + provider routing) | No | Yes |

## 7. Test, typecheck and lint coverage delta

| Gate | OPC Agent | Craft Agents | Result |
|---|---|---|---|
| `bun run test` (main suite) | 3,078 pass / 11 platform-conditional skip | (similar order of magnitude; full count TBD on fresh checkout) | both green |
| `bun run test:doc-tools` | 8 Python smoke tests for `pdf_tool`, `xlsx_tool`, `docx_tool`, `pptx_tool`, `img_tool`, `ical_tool`, `doc_diff`, `markitdown` | (same) | both green |
| `bun run typecheck:all` | passes; `apps/online-docs` is excluded from the workspace by `workspaces` globs in OPC Agent and skipped in Craft | passes | both green |
| `bun run lint` | `lint:craft-ui-sync`, `lint:craft-test-coverage`, `lint:electron`, `lint:shared`, `lint:ui` pass; **20 React Hook `exhaustive-deps` warnings retained** from upstream | adds `lint:ipc-sends`, `lint:tool-name-checks`, `lint:i18n:coverage`, `lint:i18n:strings`; **45 Craft-origin React Hook warnings** | OPC Agent's lint scope is narrower |
| `bun run audit:craft-reuse` | 96 % same-path, 59 % byte-identical, 0 missing-without-explanation | (not applicable) | green |
| `bun run lint:craft-test-coverage` | 246 kept / 5 substituted / 122 dropped-for-product-boundary / **0 missing-without-explanation** | (not applicable) | green |

The OPC-Agent-side lifts (zero "missing test without explanation") come from [`scripts/check-craft-test-coverage.ts`](../scripts/check-craft-test-coverage.ts), which enforces that every Craft test is one of: (a) same-path kept, (b) replaced with a Lite equivalent, (c) explicitly tied to a removed product area.

## 8. License & attribution

Both projects are released under **Apache-2.0**. OPC Agent ships [`NOTICE`](../NOTICE) on the repo root with the attribution upstream required, and [`docs/featues.md`](./featues.md) records the kept/removed capabilities in human-readable form. Source and release artifacts (DMG/ZIP/NSIS/AppImage, manifests, blockmaps, and checksums) now share the `iBigQiang/OpcAgent` repository; no release-only mirror is used.

## 9. Re-running this audit

```bash
# From the OPC Agent checkout
git rev-parse HEAD              # record OPC Agent commit
bun install --frozen-lockfile
bun run audit:craft-reuse       # 96 % same-path / 59 % byte-identical
bun run lint:craft-test-coverage
bun run typecheck:all
bun run lint
bun run validate:ci

# From the upstream Craft Agents checkout
git checkout a60ebc1a5a7cb0a6af7a77d5eed0512c5fc07658
ls -lah node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude   # 217 MB binary
```

If you need updated DMG / NSIS / AppImage numbers, build both products from their recorded commits with the same `electron-builder.yml` flags, then reuse [`scripts/build-server.ts`](../scripts/build-server.ts) and the per-platform `apps/electron/scripts/build-dmg.sh` to write installers.

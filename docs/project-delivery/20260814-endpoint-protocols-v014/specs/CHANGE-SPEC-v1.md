---
id: CHANGE-SPEC-001
type: change-spec
status: approved
created_at: "2026-08-14T00:26:46+08:00"
repo_root: "D:\\AiCode\\OPCAgent"
branch: craft-sources-auto
head: 8064a16
related_ids:
  - GOAL-01
supersedes: null
approval_id: AUTH-001
revisit_when: "Provider protocols or Pi SDK endpoint composition rules change."
---

# OPC Agent v0.1.4 endpoint protocol compatibility

## AI 速读卡

AgentRouter defaults to OpenAI Chat Completions and exposes an editable protocol selector. Custom connections accept an origin, a versioned Base URL, or a known full request URL, normalize it to the SDK Base URL, and preview the effective request URL. The release adds OpenAI Responses, Anthropic Messages, and Google Gemini without changing existing credentials or unrelated provider behavior.

## 背景与问题、目标和非目标

The current AgentRouter preset is silently pinned to `anthropic-messages`, while AgentRouter also serves `gpt-5.6-sol` over an OpenAI-compatible endpoint. The current two-button protocol control supports only OpenAI Completions and Anthropic Messages and does not show AgentRouter's effective protocol. The goal is a protocol dropdown, safe URL normalization, editable AgentRouter protocol, and v0.1.4 delivery. Non-goals are image-generation endpoint fields, Azure deployment-specific configuration, automatic provider discovery, and modification of installed user data.

## 用户、调用方与核心流程

Users create or edit an AI connection in Settings. They choose a provider preset and protocol, paste `https://example.com`, `https://example.com/v1`, or a known full request URL, then see the effective request URL before saving. Renderer setup data flows through server-core into shared runtime configuration and the Pi subprocess registry.

## REQ 与 NFR 需求

- REQ-001 P0: AgentRouter defaults to `openai-completions`, exposes the protocol selector while editing, and preserves the selected protocol on save.
- REQ-002 P0: OpenAI Chat Completions accepts origin, `/v1`, and `/v1/chat/completions` forms and normalizes all three to SDK Base URL `/v1` with effective preview `/v1/chat/completions`.
- REQ-003 P0: The protocol dropdown supports `openai-completions`, `openai-responses`, `anthropic-messages`, and `google-generative-ai` end to end.
- REQ-004 P1: Known full request suffixes are removed exactly once, custom path prefixes are retained, and protocol changes re-normalize without duplicating suffixes.
- REQ-005 P0: Build, validate, commit, tag, and push v0.1.4 while leaving v0.1.3 artifacts and installed user data untouched.
- NFR-001 P0: Existing connections without the new protocol values remain readable and existing credentials are neither exposed nor rewritten by migration code.
- NFR-002 P1: en and zh-Hans strings remain sorted, paired, and free of bare implementation identifiers in the visible UI.

## 硬约束、推荐默认与发挥空间

Hard constraints: use Pi SDK API identifiers, do not pass a full operation path as SDK `baseUrl`, do not infer a protocol from model name, do not alter credentials, and do not touch `D:\\AiCode\\MkAgent-craft-sources-auto`. Recommended defaults: AgentRouter uses OpenAI Chat Completions and `https://agentrouter.org/v1`; the URL field is labeled as accepting a Base URL or full request URL; the preview is read-only. Execution latitude: exact dropdown styling and helper decomposition may follow existing components if the observable behavior and tests remain unchanged.

## 项目事实、假设、未知与风险

Verified facts: `CustomEndpointApi` currently contains two values; `resolveCustomEndpointPayload` pins every platform profile to Anthropic; Pi SDK compat exposes OpenAI Completions, OpenAI Responses, Anthropic Messages, Azure Responses, and Google Generative AI adapters. Assumption: AgentRouter's three advertised models accept OpenAI Chat Completions through its `/v1` endpoint, based on the user's provider evidence. Unknown: third-party gateways may use nonstandard nested path prefixes. Risk: stripping generic path segments can corrupt valid prefixes, so only known terminal operation suffixes may be removed.

## 接口、数据与兼容影响

`CustomEndpointApi` gains `openai-responses` and `google-generative-ai`. Existing stored `customEndpoint.api` values remain valid. AgentRouter records saved through the new UI use OpenAI by default, while editing an existing record hydrates and preserves its stored protocol until the user changes it. URL normalization is a pure helper with table-driven rules and no credential input.

## ACC 验收剧本

- ACC-001: Unit tests prove the three OpenAI input forms normalize to one Base URL and one effective request URL, with no duplicated suffix.
- ACC-002: Unit and component tests prove AgentRouter defaults to OpenAI, displays the dropdown, and preserves an explicitly selected supported protocol.
- ACC-003: Each of the four protocols reaches Pi custom-provider registration with its exact API identifier and a compatible Base URL; unsupported protocol values fail validation.
- ACC-004: Typecheck, i18n checks, Craft audits, targeted tests, Electron build, and Windows NSIS packaging all pass for version 0.1.4.
- ACC-005: `OPC-Agent-0.1.4-x64.exe` exists with version metadata 0.1.4 and a recorded SHA-256; v0.1.3 artifact remains present and unchanged.
- ACC-006: A fresh independent reviewer verifies the frozen requirements and negative URL cases before commit and push.

## 发布、迁移与回滚

Prepare v0.1.4 through the repository release workflow, generate release notes, package to an isolated v0.1.4 output, commit, create an annotated tag, and push branch plus tag. Rollback is reverting the v0.1.4 commit and retaining v0.1.3; no user-data migration is performed.

## 待决事项与 revisit 条件

Azure OpenAI Responses remains a dedicated future form because deployment name and API version need additional fields. Image generation and editing Base URLs remain outside this release. Revisit normalization when the Pi SDK changes path composition or a supported provider documents a conflicting full-request URL contract.

---
id: GOAL-01
type: goal
status: approved
created_at: "2026-08-14T00:26:46+08:00"
repo_root: "D:\\AiCode\\OPCAgent"
branch: craft-sources-auto
head: 8064a16
related_ids:
  - CHANGE-SPEC-001
supersedes: null
approval_id: AUTH-001
revisit_when: "Frozen requirements, write paths, or release actions change."
---

# GOAL-01-v1: Deliver configurable endpoint protocols in OPC Agent v0.1.4

## Goal ID: GOAL-01

## Covers: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, NFR-001, NFR-002

## Why and success: Users can configure AgentRouter and custom providers with the correct protocol and flexible URL input, all frozen acceptance checks pass, and v0.1.4 is packaged and pushed.

## Verified baseline: Branch craft-sources-auto at 8064a16 is clean and synchronized with origin; v0.1.3 is committed, tagged, pushed, and separately packaged.

## Task 0: Re-read AGENTS.md, confirm clean status and HEAD, inspect current protocol types and URL composition, and run the authorization gate before business writes.

## Constraints: Preserve v0.1.3 artifacts and installed data; do not touch the old repository copy; never expose credentials; keep URL normalization limited to known terminal operation paths.

## Recommended defaults: AgentRouter uses OpenAI Chat Completions and https://agentrouter.org/v1; use the existing styled dropdown and pure helper tests.

## Execution latitude: Refactor only the endpoint form helpers needed to keep protocol and URL behavior testable; follow current naming and component style.

## Write allowlist: apps/electron endpoint setup UI and tests; packages/shared configuration, runtime types, i18n, and tests; server-core setup logic and tests; pi-agent-server protocol registration and tests; release metadata, package manifests, Craft lineage manifest, and this delivery record.

## Read-only dependencies: Pi SDK compat API definitions, electron-builder templates, existing provider presets, and existing v0.1.3 package output.

## Frozen areas: Credentials and installed configuration under C:\Users\Qiang\.opcagent; D:\OPC Agent; D:\AiCode\MkAgent-craft-sources-auto; v0.1.3 tag and artifact.

## Tasks and dependencies: First implement and test pure URL rules; then wire schema, setup, runtime, and UI; then update i18n and compatibility tests; finally prepare v0.1.4, validate, package, independently review, commit, tag, and push.

## Verification: ACC-001 through ACC-006 using unit/component tests, full relevant typechecks and audits, real NSIS compile, artifact metadata/hash inspection, and independent review.

## Stop: Stop if credentials would need migration, the provider requires an undocumented wire format, or remote history conflicts with local HEAD.

## Pause: Pause for user direction if satisfying the request requires Azure deployment fields, image endpoint support, destructive cleanup, GitHub Release creation, or scope outside the allowlist.

## Iteration and rollback: Fix failures only inside the frozen scope and rerun the failing layer plus release gates; revert the single v0.1.4 commit to return to v0.1.3 behavior.

## Handoff: Report changed files, commands and results, artifact path/hash, commit/tag/push status, independent-review evidence, and any residual provider-specific risk.

## Anti-cheat and negative safety verification: Tests must fail for duplicated operation suffixes, unsupported protocol values, accidental AgentRouter Anthropic pinning, invalid schemes, and a package that embeds a prior release directory; do not weaken existing assertions.

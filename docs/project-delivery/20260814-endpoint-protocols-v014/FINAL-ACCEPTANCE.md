# Final acceptance: OPC Agent v0.1.4 endpoint protocols

Status: accepted

## Delivered

- AgentRouter defaults to OpenAI Chat Completions at `https://agentrouter.org/v1` and includes `gpt-5.6-sol`, `claude-opus-5`, and `claude-opus-4-8`.
- AgentRouter and Generic Custom expose an editable dropdown for OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Google Gemini.
- Root URLs, versioned URLs, full known request URLs, and gateway path prefixes normalize to the SDK Base URL while showing the full effective request URL.
- Unsupported schemes, embedded URL credentials, query strings, fragments, and unsupported protocol values are rejected.
- AnyRouter and AnyRouter-Pi remain pinned to Anthropic Messages at both UI and server persistence boundaries.
- The repository README now describes OPC Agent 0.1.4, current downloads, data storage, model protocols, Sources, messaging, architecture, and upstream lineage; English and Chinese documentation indexes no longer claim restored features are absent.

## Verification

- Relevant automated tests: 149 passed before independent review; 96 focused regression tests passed after the AnyRouter server-boundary fix; the independent reviewer reran 118 tests with no failures.
- Full repository TypeScript check: passed.
- i18n parity, usage, and sorted checks: passed.
- Craft UI sync, retained-test coverage, and source-reuse audits: passed.
- Electron production build: passed.
- Windows installer configuration and packaged release-note tests: 3 passed.
- Packaged Electron UI verification: passed for AgentRouter summary, model hydration, four-protocol dropdown, OpenAI Chat preview, and protocol switching to Responses without suffix duplication.
- Independent release review: PASS with no P0, P1, or P2 blockers after the AnyRouter boundary fix.
- `git diff --check`: passed.
- Added-text Emoji scan: passed.
- README relative links, old-brand URLs, release owner/repository, and artifact naming checks: passed.

## Artifact

- Path: `apps/electron/release/v0.1.4/OPC-Agent-0.1.4-x64.exe`
- Size: 184,853,486 bytes
- SHA-256: `39A0D28D085DB8AC033FF3FBE107E294AF7774AFBD8855D524BA64C63C9C9303`
- Product version: `0.1.4.0`
- File version: `0.1.4`
- Authenticode: not signed
- Existing v0.1.3 artifact preserved with SHA-256 `ABEDF864AA278D9308D0645ED65B63470B5AF6DAEC22593F08C2AC27BFDF93EA`.

## Frozen index

- `INDEX.md` SHA-256: `698DAC7089E16F126363BB33D07D2DBB60BC369A1D39FA56425E84DABD0B8192`

## Residual notes

- Provider-specific live API calls were not made because no credentials are required or migrated for this release. The selected wire protocols and request paths are verified against the installed Pi SDK contracts and local runtime registration tests.
- The Windows installer remains unsigned; this matches the current local packaging setup and may trigger Windows reputation warnings.

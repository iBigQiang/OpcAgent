# Changelog

All notable changes to OPC Agent are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Add user-visible changes here before running `bun run release:prepare <version>`.

## [0.1.6] - 2026-08-14

This is the first public release after 0.1.4. It includes the changes from the
local-only 0.1.5 test build listed below.

### Added

- Added opt-in, privacy-safe AnyRouter-Pi request diagnostics that record HTTP status, duration, SDK retry-derived attempt, Retry-After, model aliases, request path, selected wire variant, token limit, and retry header without storing credentials, prompts, full URLs, or response bodies.
- Added isolated AnyRouter-Pi wire experiments for preserving the configured model alias, SDK token limit, or retry count one field at a time.
- Added a custom Base URL mode that preserves a complete provider request URL without protocol-specific path completion.
- Added Gemini 3.5 Flash-Lite, Gemini 3.6 Flash, and Gemini 3.7 Flash to the built-in Google AI Studio catalog and Pi runtime registry.

### Fixed

- Prevented an intercepted AnyRouter-Pi network failure from falling through to a second, unmodified provider request.
- Preserved exact custom request URLs through the Pi subprocess so providers with non-standard endpoint paths receive the configured URL.
- Fixed custom Google Gemini endpoints using `/v1beta/models` as the SDK base and producing duplicated `/models/models/` runtime request paths.

## [0.1.5] - 2026-08-14

Internal test build; not published to GitHub. All changes are included in 0.1.6.

### Fixed

- Fixed Telegram connections in Windows packages by bundling the required Telegram SDK into the desktop application.
- Unified Telegram token testing and bot polling on the same network client, surfaced safe connection-stage errors, and synchronized polling failures with the desktop status.
- Kept saved Telegram configuration visible when the bot is offline and corrected session pairing to read the actual messaging runtime.
- Added a guided Telegram flow for authorized users whose private chat is not yet bound: create a default-model session or choose an existing session, then automatically deliver the original message.
- Displayed each Telegram private-chat binding with its OPC Agent session, effective provider connection, and model.
- Fixed the Windows installer finish step so upgrades no longer try to launch the application through a Start Menu shortcut before it is ready.

## [0.1.4] - 2026-08-14

### Added

- Added editable endpoint-protocol selection for AgentRouter and custom providers, covering OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Google Gemini.

### Changed

- Changed AgentRouter's default protocol to OpenAI Chat Completions and added `gpt-5.6-sol` to its default model list.

### Fixed

- Normalized root, versioned, and full request URLs into SDK-compatible base URLs without duplicating protocol-specific request paths.

## [0.1.3] - 2026-08-13

### Added

- Added secure, one-time Telegram workspace-owner pairing codes that can only be redeemed in private chats and do not bind a session.
- Added a Windows uninstall choice to keep or remove local OPC Agent configuration and history, while preserving data during upgrades by default.

### Fixed

- Refreshed Telegram connection state immediately after saving, reconfiguring, disconnecting, or removing credentials.
- Fixed the What's New view so packaged release notes load correctly, the view always has a close action, and a GitHub Releases fallback is shown when notes are unavailable.

## [0.1.2] - 2026-08-13

### Fixed

- Removed the unintended Claude Agent SDK runtime dependency while preserving API and MCP Sources through the standard MCP SDK.
- Fixed the Windows package startup crash caused by the missing `@anthropic-ai/claude-agent-sdk` module.

## [0.1.1] - 2026-08-13

### Changed

- Renamed the product, application identifiers, CLI, configuration paths, and release assets from MkAgent to OPC Agent.
- Changed the Windows installer to an assisted setup flow that lets users choose the installation directory.
- Moved source, update, and release metadata to `iBigQiang/OpcAgent`.

## [0.1.0] - 2026-07-30

### Added

- Craft-derived workspace and session experience for Desktop and WebUI.
- OpenAI-compatible model connections through the Pi backend.
- Local skills, browser tools, document tools, permissions, themes, and workspace settings.
- Local session search, flags, archives, import, export, and branching.

[Unreleased]: https://github.com/iBigQiang/OpcAgent/releases
[0.1.6]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.6
[0.1.4]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.4
[0.1.3]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.3
[0.1.2]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.2
[0.1.1]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.1
[0.1.0]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.0

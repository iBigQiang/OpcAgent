# Changelog

All notable changes to OPC Agent are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Add user-visible changes here before running `bun run release:prepare <version>`.

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
[0.1.4]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.4
[0.1.3]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.3
[0.1.2]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.2
[0.1.1]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.1
[0.1.0]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.0

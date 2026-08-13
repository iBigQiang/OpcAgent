# Changelog

All notable changes to OPC Agent are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Add user-visible changes here before running `bun run release:prepare <version>`.

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
[0.1.2]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.2
[0.1.1]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.1
[0.1.0]: https://github.com/iBigQiang/OpcAgent/releases/tag/v0.1.0

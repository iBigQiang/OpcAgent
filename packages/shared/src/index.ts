/**
 * @opcagent/shared
 *
 * Shared business logic for OPCAgent.
 * Used by the Electron app.
 *
 * Import specific modules via subpath exports:
 *   import { PiAgent } from '@opcagent/shared/agent';
 *   import { loadStoredConfig } from '@opcagent/shared/config';
 *   import { getCredentialManager } from '@opcagent/shared/credentials';
 *   import { debug } from '@opcagent/shared/utils';
 *   import { createWorkspace, loadWorkspace } from '@opcagent/shared/workspaces';
 *
 * Available modules:
 *   - agent: Pi agent runtime and plan tools
 *   - config: Storage, models, preferences
 *   - credentials: Encrypted credential storage
 *   - prompts: System prompt generation
 *   - utils: Debug logging, file handling, summarization
 *   - version: Version and installation management
 *   - workspaces: Workspace management (top-level organizational unit)
 */

// Export branding (standalone, no dependencies)
export * from './branding.ts';

// Domain modules restored by AUTH-001. Consumers that need filesystem-backed
// helpers should continue to import the explicit subpath.
export * from './automations/index.ts';
export * from './projects/index.ts';
export * from './labels/index.ts';

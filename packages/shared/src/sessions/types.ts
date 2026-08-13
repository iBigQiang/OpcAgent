import type {
  MessageRole,
  StoredAttachment,
  StoredMessage,
  ToolStatus,
} from '@mkagent/core/types';
import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';

export const SESSION_PERSISTENT_FIELDS = [
  'id', 'workspaceRootPath', 'sdkSessionId', 'sdkCwd',
  'createdAt', 'lastUsedAt', 'lastMessageAt',
  'name', 'isFlagged', 'labels', 'hidden',
  'lastReadMessageId', 'hasUnread',
  'enabledSourceSlugs', 'permissionMode', 'previousPermissionMode', 'workingDirectory',
  'model', 'llmConnection', 'connectionLocked', 'thinkingLevel',
  'pendingPlanExecution',
  'triggeredBy', 'projectId',
  'isArchived', 'archivedAt',
  'branchFromMessageId', 'branchFromSdkSessionId', 'branchFromSessionPath',
  'branchFromSdkCwd', 'branchFromSdkTurnId',
  'parentSessionId',
] as const;

export type SessionPersistentField = (typeof SESSION_PERSISTENT_FIELDS)[number];

export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  costUsd: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  contextWindow?: number;
}

export type { StoredMessage } from '@mkagent/core/types';

export interface PendingPlanExecution {
  planPath: string;
  draftInputSnapshot?: string;
  awaitingCompaction: boolean;
  executionDispatched?: boolean;
}

export interface SessionConfig {
  id: string;
  sdkSessionId?: string;
  workspaceRootPath: string;
  name?: string;
  createdAt: number;
  lastUsedAt: number;
  lastMessageAt?: number;
  isFlagged?: boolean;
  /** Labels applied to this session (bare IDs or "id::value" entries). */
  labels?: string[];
  permissionMode?: PermissionMode;
  previousPermissionMode?: PermissionMode;
  lastReadMessageId?: string;
  hasUnread?: boolean;
  /** Explicit per-session Source selection. */
  enabledSourceSlugs?: string[];
  workingDirectory?: string;
  sdkCwd?: string;
  model?: string;
  llmConnection?: string;
  connectionLocked?: boolean;
  thinkingLevel?: ThinkingLevel;
  pendingPlanExecution?: PendingPlanExecution;
  /** Metadata for sessions created by automations. */
  triggeredBy?: { automationName?: string; event?: string; timestamp?: number };
  /** Workspace-scoped project id this session belongs to. */
  projectId?: string;
  hidden?: boolean;
  isArchived?: boolean;
  archivedAt?: number;
  branchFromMessageId?: string;
  branchFromSdkSessionId?: string;
  branchFromSessionPath?: string;
  branchFromSdkCwd?: string;
  branchFromSdkTurnId?: string;
  parentSessionId?: string;
}

export interface StoredSession extends SessionConfig {
  messages: StoredMessage[];
  tokenUsage: SessionTokenUsage;
}

export interface SessionHeader extends SessionConfig {
  messageCount: number;
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error';
  preview?: string;
  tokenUsage: SessionTokenUsage;
  lastFinalMessageId?: string;
}

export interface SessionMetadata extends SessionConfig {
  messageCount: number;
  preview?: string;
  planCount?: number;
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error';
  lastFinalMessageId?: string;
  tokenUsage?: SessionTokenUsage;
}

export interface AuthRequestMessage {
  id: string;
  role: 'error';
  content: string;
  timestamp: number;
}

export interface SessionRuntimeMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  attachments?: StoredAttachment[];
  toolStatus?: ToolStatus;
}

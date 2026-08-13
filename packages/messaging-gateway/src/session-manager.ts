import type { FileAttachment, PermissionResponseOptions } from '@opcagent/shared/protocol'

export interface MessagingSession {
  id: string
  workspaceId: string
  name?: string
  isArchived?: boolean
  lastMessageAt: number
}

export interface MessagingSessionManager {
  getSessions(workspaceId?: string): MessagingSession[]
  getSession(sessionId: string): Promise<MessagingSession | null>
  createSession(workspaceId: string, options?: { name?: string }): Promise<MessagingSession>
  sendMessage(sessionId: string, message: string, attachments?: FileAttachment[]): Promise<void>
  cancelProcessing(sessionId: string, silent?: boolean): Promise<void>
  respondToPermission(sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean, options?: PermissionResponseOptions): boolean
  setPendingPlanExecution(sessionId: string, planPath: string, draftInputSnapshot?: string): Promise<void>
  clearPendingPlanExecution(sessionId: string): Promise<void>
  acceptPlan(sessionId: string, planPath?: string): Promise<void>
  getSessionPath(sessionId: string): string | null
}

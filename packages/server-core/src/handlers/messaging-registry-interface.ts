import type {
  BindingAccessMode,
  ChannelBinding,
  LarkCredentialTestResult,
  LarkCredentials,
  MessagingConfig,
  PendingSender,
  PlatformRuntimeInfo,
  PlatformType,
  TelegramCredentialTestResult,
} from '@opcagent/messaging-gateway'
import type { WhatsAppUiEvent } from '@opcagent/shared/protocol'

export type MessagingPendingEntryKey = Required<Pick<PendingSender, 'reason'>> & Pick<PendingSender, 'bindingId'>
export interface MessagingPairingCode { code: string; expiresAt: number; botUsername?: string }
export interface MessagingSupergroupInfo { chatId: string; title: string; capturedAt: number }
export interface MessagingPlatformOwnerInfo { userId: string; displayName?: string; username?: string; addedAt: number }
export interface MessagingPendingPromotion { owners: MessagingPlatformOwnerInfo[]; bindingId?: string }

/**
 * Server-core's complete Messaging contract. The concrete gateway owns
 * credentials and provider workers; these methods never expose their values.
 */
export interface IMessagingGatewayRegistry {
  getConfig(workspaceId: string): MessagingConfig
  updateConfig(workspaceId: string, patch: Partial<MessagingConfig>): Promise<MessagingConfig>
  getBindings(workspaceId: string): ChannelBinding[]
  bind(workspaceId: string, input: Omit<ChannelBinding, 'id' | 'createdAt' | 'enabled' | 'config' | 'workspaceId'> & { config?: Partial<ChannelBinding['config']> }): ChannelBinding
  unbindBinding(workspaceId: string, bindingId: string): boolean
  unbindSession(workspaceId: string, sessionId: string, platform?: PlatformType): number
  setBindingAccess(workspaceId: string, bindingId: string, access: { mode: BindingAccessMode; allowedSenderIds?: string[] }): ChannelBinding | null
  setPlatformOwners(workspaceId: string, platform: PlatformType, owners: MessagingPlatformOwnerInfo[]): MessagingPlatformOwnerInfo[]
  setPlatformAccessMode(workspaceId: string, platform: PlatformType, mode: 'open' | 'owner-only'): void
  getPlatformOwners(workspaceId: string, platform: PlatformType): MessagingPlatformOwnerInfo[]
  getPlatformAccessMode(workspaceId: string, platform: PlatformType): 'open' | 'owner-only'
  getPendingSenders(workspaceId: string, platform?: PlatformType): PendingSender[]
  dismissPendingSender(workspaceId: string, platform: PlatformType, senderId: string, entryKey: MessagingPendingEntryKey): boolean
  allowPendingSender(workspaceId: string, platform: PlatformType, senderId: string, entryKey: MessagingPendingEntryKey): MessagingPendingPromotion
  saveTelegramToken(workspaceId: string, token: string): Promise<void>
  saveLarkCredentials(workspaceId: string, credentials: LarkCredentials): Promise<void>
  testTelegramToken(token: string): Promise<TelegramCredentialTestResult>
  testLarkCredentials(credentials: LarkCredentials): Promise<LarkCredentialTestResult>
  disconnectPlatform(workspaceId: string, platform: PlatformType): Promise<void>
  forgetPlatform(workspaceId: string, platform: PlatformType): Promise<void>
  getRuntime(workspaceId: string): PlatformRuntimeInfo[]
  sendSessionText(workspaceId: string, sessionId: string, text: string): Promise<void>

  /** Required gateway-core extensions for the restored desktop flow. */
  generatePairingCode(workspaceId: string, sessionId: string, platform: PlatformType): MessagingPairingCode
  generateOwnerPairingCode(workspaceId: string, platform: 'telegram'): MessagingPairingCode
  generateSupergroupPairingCode(workspaceId: string, platform: 'telegram'): MessagingPairingCode
  getWorkspaceSupergroup(workspaceId: string): MessagingSupergroupInfo | null
  unbindWorkspaceSupergroup(workspaceId: string): Promise<void>
  bindAutomationTopic(workspaceId: string, topicName: string, sessionId: string): Promise<{ channelId: string; threadId: number }>
  startWhatsAppConnect(workspaceId: string): Promise<void>
  submitWhatsAppPhone(workspaceId: string, phoneNumber: string): Promise<void>
  onWhatsAppUiEvent(listener: (workspaceId: string, event: WhatsAppUiEvent) => void): () => void
}

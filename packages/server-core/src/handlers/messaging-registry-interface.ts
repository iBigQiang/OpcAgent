import type { BindingAccessMode, ChannelBinding, LarkCredentialTestResult, LarkCredentials, MessagingConfig, PendingSender, PlatformRuntimeInfo, PlatformType, TelegramCredentialTestResult } from '@mkagent/messaging-gateway'

/** Server-core depends only on this narrow contract; adapters and credentials remain outside it. */
export interface IMessagingGatewayRegistry {
  getConfig(workspaceId: string): MessagingConfig
  updateConfig(workspaceId: string, patch: Partial<MessagingConfig>): Promise<MessagingConfig>
  getBindings(workspaceId: string): ChannelBinding[]
  bind(workspaceId: string, input: Omit<ChannelBinding, 'id' | 'createdAt' | 'enabled' | 'config' | 'workspaceId'> & { config?: Partial<ChannelBinding['config']> }): ChannelBinding
  unbindBinding(workspaceId: string, bindingId: string): boolean
  unbindSession(workspaceId: string, sessionId: string, platform?: PlatformType): number
  setBindingAccess(workspaceId: string, bindingId: string, accessMode: BindingAccessMode, allowedSenderIds?: string[]): ChannelBinding | null
  setPlatformOwners(workspaceId: string, platform: PlatformType, ownerIds: string[]): MessagingConfig
  setPlatformAccessMode(workspaceId: string, platform: PlatformType, mode: 'open' | 'owner-only'): MessagingConfig
  getPlatformOwners(workspaceId: string, platform: PlatformType): string[]
  getPlatformAccessMode(workspaceId: string, platform: PlatformType): 'open' | 'owner-only'
  getPendingSenders(workspaceId: string, platform?: PlatformType): PendingSender[]
  dismissPendingSender(workspaceId: string, platform: PlatformType, senderId: string): boolean
  allowPendingSender(workspaceId: string, platform: PlatformType, senderId: string): string[]
  saveCredential(workspaceId: string, platform: PlatformType, value: string): Promise<void>
  forgetCredential(workspaceId: string, platform: PlatformType): Promise<void>
  testTelegramToken(token: string): Promise<TelegramCredentialTestResult>
  testLarkCredentials(credentials: LarkCredentials): Promise<LarkCredentialTestResult>
  connect(workspaceId: string, platform: PlatformType): Promise<void>
  disconnect(workspaceId: string, platform: PlatformType): Promise<void>
  getRuntime(workspaceId: string): PlatformRuntimeInfo[]
  sendSessionText(workspaceId: string, sessionId: string, text: string): Promise<void>
}

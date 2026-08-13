export type PlatformType = 'telegram' | 'whatsapp' | 'lark'
export type BindingAccessMode = 'inherit' | 'allow-list' | 'open'
export type PlatformAccessMode = 'open' | 'owner-only'
export type PlatformRuntimeState = 'disconnected' | 'connecting' | 'connected' | 'reconnect_required' | 'error'

export interface MessagingLogger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  child?(meta: Record<string, unknown>): MessagingLogger
}

export interface MessagingPlatformConfig { enabled?: boolean; botUsername?: string; acceptedSupergroupChatId?: string }
export interface MessagingConfig { version: 1; enabled: boolean; platforms: Partial<Record<PlatformType, MessagingPlatformConfig>>; access?: Partial<Record<PlatformType, { mode: PlatformAccessMode; ownerIds: string[] }>> }
export interface ChannelBinding { id: string; workspaceId: string; sessionId: string; platform: PlatformType; channelId: string; threadId?: number; channelName?: string; enabled: boolean; createdAt: number; config: { accessMode: BindingAccessMode; allowedSenderIds?: string[]; responseMode: 'streaming' | 'progress' | 'final_only' } }
export interface IncomingMessage { platform: PlatformType; channelId: string; threadId?: number; messageId: string; senderId: string; senderName?: string; senderUsername?: string; senderIsBot?: boolean; text: string; timestamp: number; raw?: unknown }
export interface PlatformRuntimeInfo { platform: PlatformType; configured: boolean; connected: boolean; state: PlatformRuntimeState; identity?: string; qrCode?: string; lastError?: string; updatedAt: number }
export interface PlatformAdapter { readonly platform: PlatformType; initialize(config: { credential: string; config: MessagingPlatformConfig }): Promise<void>; destroy(): Promise<void>; isConnected(): boolean; onMessage(handler: (message: IncomingMessage) => Promise<void>): void; onStatus?(handler: (patch: Partial<PlatformRuntimeInfo>) => void): void; sendText(channelId: string, text: string, options?: { threadId?: number }): Promise<void> }
export const DEFAULT_MESSAGING_CONFIG: MessagingConfig = { version: 1, enabled: false, platforms: {}, access: {} }

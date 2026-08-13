export type PlatformType = 'telegram' | 'whatsapp' | 'lark'
export type BindingAccessMode = 'inherit' | 'allow-list' | 'open'
export type PlatformAccessMode = 'open' | 'owner-only'
export type PlatformRuntimeState = 'disconnected' | 'connecting' | 'connected' | 'reconnect_required' | 'error'
export type ResponseMode = 'streaming' | 'progress' | 'final_only'

export interface MessagingLogger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  child?(meta: Record<string, unknown>): MessagingLogger
}

export interface MessagingPlatformConfig {
  enabled?: boolean
  botUsername?: string
  acceptedSupergroupChatId?: string
  acceptedSupergroupTitle?: string
  acceptedSupergroupCapturedAt?: number
  allowedGroupJids?: string[]
}
export interface MessagingConfig { version: 1; enabled: boolean; platforms: Partial<Record<PlatformType, MessagingPlatformConfig>>; access?: Partial<Record<PlatformType, { mode: PlatformAccessMode; ownerIds: string[] }>> }
export interface BindingConfig { accessMode: BindingAccessMode; allowedSenderIds?: string[]; responseMode: ResponseMode; streamResponses?: boolean; showToolActivity?: boolean; approvalChannel?: 'chat' | 'app'; editIntervalMs?: number }
export interface ChannelBinding { id: string; workspaceId: string; sessionId: string; platform: PlatformType; channelId: string; threadId?: number; channelName?: string; enabled: boolean; createdAt: number; config: BindingConfig }
export interface AdapterCapabilities { messageEditing: boolean; inlineButtons: boolean; maxButtons: number; maxMessageLength: number; markdown: 'v2' | 'whatsapp' | 'lark-post'; webhookSupport: boolean }
export interface SendOptions { threadId?: number }
export interface SentMessage { platform: PlatformType; channelId: string; messageId: string }
export interface IncomingAttachment { type: 'photo' | 'document' | 'voice' | 'video' | 'audio'; fileId: string; fileName?: string; mimeType?: string; fileSize?: number; localPath?: string }
export interface IncomingMessage {
  platform: PlatformType
  channelId: string
  threadId?: number
  channelName?: string
  chatType?: 'private' | 'supergroup' | 'group' | 'channel'
  messageId: string
  senderId: string
  senderName?: string
  senderUsername?: string
  senderIsBot?: boolean
  text: string
  attachments?: IncomingAttachment[]
  timestamp: number
  raw?: unknown
}
export interface PlatformRuntimeInfo { platform: PlatformType; configured: boolean; connected: boolean; state: PlatformRuntimeState; identity?: string; qrCode?: string; lastError?: string; updatedAt: number }
export interface PlatformAdapter {
  readonly platform: PlatformType
  readonly capabilities?: AdapterCapabilities
  initialize(config: { credential: string; config: MessagingPlatformConfig }): Promise<void>
  destroy(): Promise<void>
  isConnected(): boolean
  onMessage(handler: (message: IncomingMessage) => Promise<void>): void
  onButtonPress?(handler: (press: ButtonPress) => Promise<void>): void
  onStatus?(handler: (patch: Partial<PlatformRuntimeInfo>) => void): void
  onUiEvent?(handler: (event: WhatsAppUiEvent) => void): void
  sendText(channelId: string, text: string, options?: SendOptions): Promise<void | SentMessage>
  editMessage?(channelId: string, messageId: string, text: string, options?: SendOptions): Promise<void>
  sendButtons?(channelId: string, text: string, buttons: InlineButton[], options?: SendOptions): Promise<void | SentMessage>
  sendTyping?(channelId: string, options?: SendOptions): Promise<void>
  sendFile?(channelId: string, file: Buffer, filename: string, caption?: string, options?: SendOptions): Promise<void | SentMessage>
  clearButtons?(channelId: string, messageId: string): Promise<void>
  setAcceptedSupergroupChatId?(chatId?: string): void
  getChatInfo?(channelId: string): Promise<{ id: string; title?: string; type?: string; isForum?: boolean }>
  createForumTopic?(channelId: string, name: string): Promise<{ threadId: number; name?: string }>
}
export interface InlineButton { id: string; label: string; data?: string }
export interface ButtonPress { platform: PlatformType; channelId: string; threadId?: number; messageId: string; senderId: string; senderIsBot?: boolean; buttonId: string; data?: string }
export type WhatsAppUiEvent =
  | { type: 'qr'; qr: string }
  | { type: 'pairing_code'; code: string }
  | { type: 'connected'; jid?: string; name?: string }
  | { type: 'disconnected'; loggedOut: boolean; reason?: string }
  | { type: 'unavailable'; reason: string; message: string }
  | { type: 'error'; message: string }
export const DEFAULT_MESSAGING_CONFIG: MessagingConfig = { version: 1, enabled: false, platforms: {}, access: {} }

import { getCredentialManager } from '@mkagent/shared/credentials'
import { BindingStore } from './binding-store'
import { ConfigStore } from './config-store'
import { MessageRouter } from './router'
import { setPlatformOwners } from './access-control'
import { PendingSenders, type PendingSender } from './pending-senders'
import type { LarkCredentials } from './adapters/lark'
import type { BindingAccessMode, ChannelBinding, MessagingConfig, MessagingLogger, PlatformAdapter, PlatformRuntimeInfo, PlatformType } from './types'

const NOOP: MessagingLogger = { info() {}, warn() {}, error() {} }
const platforms: PlatformType[] = ['telegram', 'whatsapp', 'lark']

export interface TelegramCredentialTestResult {
  success: boolean
  botName?: string
  botUsername?: string
  error?: string
}

export interface LarkCredentialTestResult {
  success: boolean
  error?: string
}

export interface MessagingGatewayRegistryOptions {
  getMessagingDir(workspaceId: string): string
  sendToSession(workspaceId: string, sessionId: string, text: string): Promise<void>
  logger?: MessagingLogger
  adapters?: Partial<Record<PlatformType, PlatformAdapter>>
  createAdapter?: (platform: PlatformType, workspaceId: string) => PlatformAdapter | undefined
  publish?: (channel: string, workspaceId: string, payload?: unknown) => void
}

interface WorkspaceState { config: ConfigStore; bindings: BindingStore; pending: PendingSenders; runtime: Record<PlatformType, PlatformRuntimeInfo>; router: MessageRouter; adapters: Partial<Record<PlatformType, PlatformAdapter>> }

/** Workspace-isolated registry. It never exposes credential values to callers or events. */
export class MessagingGatewayRegistry {
  private readonly workspaces = new Map<string, WorkspaceState>()
  /** An adapter owns message handlers, so one instance must never serve two workspaces. */
  private readonly adapterOwners = new Map<PlatformAdapter, string>()
  private readonly logger: MessagingLogger
  constructor(private readonly options: MessagingGatewayRegistryOptions) { this.logger = options.logger ?? NOOP }
  setPublisher(publish: NonNullable<MessagingGatewayRegistryOptions['publish']>): void { this.options.publish = publish }
  getConfig(workspaceId: string): MessagingConfig { return this.state(workspaceId).config.get() }
  async updateConfig(workspaceId: string, patch: Partial<MessagingConfig>): Promise<MessagingConfig> { const config = this.state(workspaceId).config.update(patch); this.publish('messaging:platformStatus', workspaceId, this.getRuntime(workspaceId)); return config }
  getBindings(workspaceId: string): ChannelBinding[] { return this.state(workspaceId).bindings.getAll() }
  bind(workspaceId: string, input: Omit<ChannelBinding, 'id' | 'createdAt' | 'enabled' | 'config' | 'workspaceId'> & { config?: Partial<ChannelBinding['config']> }): ChannelBinding { const binding = this.state(workspaceId).bindings.bind({ ...input, workspaceId }); this.publish('messaging:bindingChanged', workspaceId); return binding }
  unbindBinding(workspaceId: string, bindingId: string): boolean { const result = this.state(workspaceId).bindings.unbindById(bindingId); if (result) this.publish('messaging:bindingChanged', workspaceId); return result }
  unbindSession(workspaceId: string, sessionId: string, platform?: PlatformType): number { const result = this.state(workspaceId).bindings.unbindSession(sessionId, platform); if (result) this.publish('messaging:bindingChanged', workspaceId); return result }
  setBindingAccess(workspaceId: string, bindingId: string, accessMode: BindingAccessMode, allowedSenderIds?: string[]): ChannelBinding | null { const binding = this.state(workspaceId).bindings.setAccess(bindingId, accessMode, allowedSenderIds); if (binding) this.publish('messaging:bindingChanged', workspaceId); return binding }
  setPlatformOwners(workspaceId: string, platform: PlatformType, ownerIds: string[]): MessagingConfig { const state = this.state(workspaceId); const config = setPlatformOwners(state.config.get(), platform, ownerIds); const saved = state.config.update(config); this.publish('messaging:bindingChanged', workspaceId); return saved }
  setPlatformAccessMode(workspaceId: string, platform: PlatformType, mode: 'open' | 'owner-only'): MessagingConfig { const state = this.state(workspaceId); const saved = state.config.update({ access: { ...state.config.get().access, [platform]: { mode, ownerIds: state.config.get().access?.[platform]?.ownerIds ?? [] } } }); this.publish('messaging:bindingChanged', workspaceId); return saved }
  getPlatformOwners(workspaceId: string, platform: PlatformType): string[] { return [...(this.state(workspaceId).config.get().access?.[platform]?.ownerIds ?? [])] }
  getPlatformAccessMode(workspaceId: string, platform: PlatformType): 'open' | 'owner-only' { return this.state(workspaceId).config.get().access?.[platform]?.mode ?? 'open' }
  getPendingSenders(workspaceId: string, platform?: PlatformType): PendingSender[] { return this.workspaces.get(workspaceId)?.pending.list(platform) ?? [] }
  dismissPendingSender(workspaceId: string, platform: PlatformType, senderId: string): boolean { return this.workspaces.get(workspaceId)?.pending.dismiss(platform, senderId) ?? false }
  allowPendingSender(workspaceId: string, platform: PlatformType, senderId: string): string[] {
    const state = this.state(workspaceId)
    const pending = state.pending.find(platform, senderId)
    if (!pending) throw new Error('Pending sender not found')
    if (pending.reason === 'not-on-binding-allowlist') {
      const binding = state.bindings.getAll().find(item => item.id === pending.bindingId)
      if (!binding) throw new Error('Binding no longer exists')
      state.bindings.setAccess(binding.id, 'allow-list', [...new Set([...(binding.config.allowedSenderIds ?? []), senderId])])
      state.pending.dismiss(platform, senderId)
      this.publish('messaging:bindingChanged', workspaceId)
      return this.getPlatformOwners(workspaceId, platform)
    }
    const owners = [...new Set([...this.getPlatformOwners(workspaceId, platform), senderId])]
    this.setPlatformOwners(workspaceId, platform, owners)
    state.pending.dismiss(platform, senderId)
    this.publish('messaging:bindingChanged', workspaceId)
    return owners
  }
  async saveCredential(workspaceId: string, platform: PlatformType, value: string): Promise<void> { if (!value.trim()) throw new Error('Credential is required'); await getCredentialManager().set({ type: 'source_bearer', workspaceId, sourceId: `messaging-${platform}` }, { value }); this.patchRuntime(workspaceId, platform, { configured: true, state: 'disconnected', connected: false }) }
  async forgetCredential(workspaceId: string, platform: PlatformType): Promise<void> { await getCredentialManager().delete({ type: 'source_bearer', workspaceId, sourceId: `messaging-${platform}` }); this.patchRuntime(workspaceId, platform, { configured: false, state: 'disconnected', connected: false }) }
  /** Tests an explicitly supplied token without persisting or logging it. */
  async testTelegramToken(token: string): Promise<TelegramCredentialTestResult> {
    const trimmed = typeof token === 'string' ? token.trim() : ''
    if (!trimmed) return { success: false, error: 'Token is required' }
    try {
      const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(trimmed)}/getMe`)
      const body = await response.json() as { ok?: boolean; result?: { first_name?: unknown; username?: unknown } }
      if (!response.ok || body.ok !== true) return { success: false, error: 'Telegram rejected the token' }
      const botName = typeof body.result?.first_name === 'string' ? body.result.first_name : undefined
      const botUsername = typeof body.result?.username === 'string' ? body.result.username : undefined
      return { success: true, ...(botName ? { botName } : {}), ...(botUsername ? { botUsername } : {}) }
    } catch {
      return { success: false, error: 'Unable to verify the Telegram token' }
    }
  }
  /** Tests explicitly supplied Lark/Feishu credentials without persisting or logging them. */
  async testLarkCredentials(credentials: LarkCredentials): Promise<LarkCredentialTestResult> {
    const appId = typeof credentials?.appId === 'string' ? credentials.appId.trim() : ''
    const appSecret = typeof credentials?.appSecret === 'string' ? credentials.appSecret.trim() : ''
    if (!appId || !appSecret) return { success: false, error: 'App ID and App Secret are required' }
    if (credentials.domain !== 'lark' && credentials.domain !== 'feishu') return { success: false, error: 'Unsupported Lark domain' }
    const origin = credentials.domain === 'feishu' ? 'https://open.feishu.cn' : 'https://open.larksuite.com'
    try {
      const response = await fetch(`${origin}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      })
      const body = await response.json() as { code?: unknown; tenant_access_token?: unknown }
      return response.ok && body.code === 0 && typeof body.tenant_access_token === 'string' && body.tenant_access_token.length > 0
        ? { success: true }
        : { success: false, error: 'Lark rejected the credentials' }
    } catch {
      return { success: false, error: 'Unable to verify the Lark credentials' }
    }
  }
  async connect(workspaceId: string, platform: PlatformType): Promise<void> { const state = this.state(workspaceId); const adapter = state.adapters[platform]; let credential: { value: string } | null = null; try { credential = await getCredentialManager().get({ type: 'source_bearer', workspaceId, sourceId: `messaging-${platform}` }) } catch { this.patchRuntime(workspaceId, platform, { configured: false, connected: false, state: 'disconnected', lastError: 'Credential is unavailable' }); return } const canConnect = platform === 'whatsapp' || Boolean(credential); if (!adapter || !canConnect) { this.patchRuntime(workspaceId, platform, { configured: Boolean(credential) || platform === 'whatsapp', connected: false, state: adapter ? 'disconnected' : 'error', lastError: adapter ? 'Credential is not configured' : 'Platform adapter is unavailable' }); return } if (adapter.isConnected()) { this.patchRuntime(workspaceId, platform, { configured: true, connected: true, state: 'connected', lastError: undefined }); return } this.patchRuntime(workspaceId, platform, { configured: true, connected: false, state: 'connecting', lastError: undefined }); try { adapter.onMessage(async message => { await state.router.route(message) }); adapter.onStatus?.(patch => this.patchRuntime(workspaceId, platform, patch)); await adapter.initialize({ credential: credential?.value ?? '', config: this.getConfig(workspaceId).platforms[platform] ?? {} }); this.patchRuntime(workspaceId, platform, { configured: true, connected: adapter.isConnected(), state: adapter.isConnected() ? 'connected' : 'connecting' }) } catch { this.patchRuntime(workspaceId, platform, { configured: true, connected: false, state: 'error', lastError: 'Connection failed. Check configuration and provider permissions.' }) } }
  async disconnect(workspaceId: string, platform: PlatformType): Promise<void> { const adapter = this.state(workspaceId).adapters[platform]; if (adapter) await adapter.destroy().then(() => undefined, () => undefined); this.patchRuntime(workspaceId, platform, { connected: false, state: 'disconnected' }) }
  getRuntime(workspaceId: string): PlatformRuntimeInfo[] { return platforms.map(platform => ({ ...this.state(workspaceId).runtime[platform] })) }
  async sendSessionText(workspaceId: string, sessionId: string, text: string): Promise<void> { const state = this.state(workspaceId); const bindings = state.bindings.getAll().filter(binding => binding.enabled && binding.sessionId === sessionId); await Promise.allSettled(bindings.map(binding => state.adapters[binding.platform]?.sendText(binding.channelId, text.slice(0, 30_000), binding.threadId === undefined ? undefined : { threadId: binding.threadId }))) }
  async dispose(): Promise<void> { await Promise.all([...this.workspaces.values()].flatMap(state => Object.values(state.adapters).map(async adapter => { try { await adapter?.destroy() } catch {} }))); this.adapterOwners.clear(); this.workspaces.clear() }
  private state(workspaceId: string): WorkspaceState { let state = this.workspaces.get(workspaceId); if (state) return state; const dir = this.options.getMessagingDir(workspaceId); const config = new ConfigStore(dir, this.logger); const bindings = new BindingStore(dir); const pending = new PendingSenders(100, () => this.publish('messaging:pendingChanged', workspaceId)); const runtime = Object.fromEntries(platforms.map(platform => [platform, { platform, configured: platform === 'whatsapp', connected: false, state: 'disconnected', updatedAt: Date.now() }])) as Record<PlatformType, PlatformRuntimeInfo>; const router = new MessageRouter({ bindingStore: bindings, getConfig: () => config.get(), sendToSession: (sessionId, text) => this.options.sendToSession(workspaceId, sessionId, text), logger: this.logger, onUnauthorized: (message, binding, reason) => pending.add({ platform: message.platform, senderId: message.senderId, ...(message.senderName ? { senderName: message.senderName } : {}), bindingId: binding.id, reason, createdAt: Date.now() }) }); const adapters = Object.fromEntries(platforms.map(platform => [platform, this.claimAdapter(this.options.createAdapter?.(platform, workspaceId) ?? this.options.adapters?.[platform], workspaceId)])) as Partial<Record<PlatformType, PlatformAdapter>>; state = { config, bindings, pending, runtime, router, adapters }; this.workspaces.set(workspaceId, state); return state }
  private claimAdapter(adapter: PlatformAdapter | undefined, workspaceId: string): PlatformAdapter | undefined { if (!adapter) return undefined; const owner = this.adapterOwners.get(adapter); if (owner && owner !== workspaceId) { this.logger.warn('Messaging adapter instance already belongs to another workspace'); return undefined } this.adapterOwners.set(adapter, workspaceId); return adapter }
  private patchRuntime(workspaceId: string, platform: PlatformType, patch: Partial<PlatformRuntimeInfo>): void { const state = this.state(workspaceId); state.runtime[platform] = { ...state.runtime[platform], ...patch, platform, updatedAt: Date.now() }; this.publish('messaging:platformStatus', workspaceId, { ...state.runtime[platform] }) }
  private publish(channel: string, workspaceId: string, payload?: unknown): void { this.options.publish?.(channel, workspaceId, payload) }
}

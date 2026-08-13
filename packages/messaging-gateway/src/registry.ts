import { getCredentialManager } from '@mkagent/shared/credentials'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { relative, sep } from 'node:path'
import type { SessionEvent } from '@mkagent/shared/protocol'
import type { MessagingSessionManager } from './session-manager'
import { BindingStore } from './binding-store'
import { ConfigStore } from './config-store'
import { MessageRouter } from './router'
import { Commands } from './commands'
import { PairingCodeManager } from './pairing'
import { TopicRegistry } from './topic-registry'
import { MessagingRenderer } from './renderer'
import { isSenderAllowed, seedFirstPlatformOwner, setPlatformOwners } from './access-control'
import { PlanTokenRegistry } from './plan-tokens'
import { PendingSenders, type PendingSender, type PendingSenderKey } from './pending-senders'
import type { LarkCredentials } from './adapters/lark'
import { TelegramAdapter } from './adapters/telegram'
import { LarkAdapter } from './adapters/lark'
import { WhatsAppAdapter } from './adapters/whatsapp'
import type { BindingAccessMode, ButtonPress, ChannelBinding, MessagingConfig, MessagingLogger, PlatformAdapter, PlatformRuntimeInfo, PlatformType, WhatsAppUiEvent } from './types'

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
  sessionManager?: MessagingSessionManager
  /** Credentials remain accessed only inside this package and are never returned by Messaging APIs. */
  credentialManager?: MessagingCredentialManager
  whatsapp?: { workerEntry: string; nodeBin?: string; pairingMode?: 'qr' | 'code'; electronRunAsNode?: boolean }
  sendToSession?: (workspaceId: string, sessionId: string, text: string, attachments?: import('@mkagent/shared/protocol').FileAttachment[]) => Promise<void>
  logger?: MessagingLogger
  adapters?: Partial<Record<PlatformType, PlatformAdapter>>
  createAdapter?: (platform: PlatformType, workspaceId: string) => PlatformAdapter | undefined
  publish?: (channel: string, workspaceId: string, payload?: unknown) => void
}

interface MessagingCredentialManager {
  get(id: { type: 'source_bearer'; workspaceId: string; sourceId: string }): Promise<{ value: string } | null>
  set(id: { type: 'source_bearer'; workspaceId: string; sourceId: string }, value: { value: string }): Promise<void>
  delete(id: { type: 'source_bearer'; workspaceId: string; sourceId: string }): Promise<boolean>
}

interface WorkspaceState {
  config: ConfigStore
  bindings: BindingStore
  pending: PendingSenders
  topics: TopicRegistry
  runtime: Record<PlatformType, PlatformRuntimeInfo>
  router: MessageRouter
  commands: Commands
  renderer: MessagingRenderer
  planTokens: PlanTokenRegistry
  permissionMessages: Map<string, { bindingId: string; channelId: string; messageId: string }>
  planMessages: Map<string, { bindingId: string; channelId: string; messageId: string }>
  pendingCompact: Map<string, { bindingId: string; channelId: string; threadId?: number; planPath: string }>
  adapters: Partial<Record<PlatformType, PlatformAdapter>>
}

/** Workspace-isolated registry. It never exposes credential values to callers or events. */
export class MessagingGatewayRegistry {
  private readonly workspaces = new Map<string, WorkspaceState>()
  /** An adapter owns message handlers, so one instance must never serve two workspaces. */
  private readonly adapterOwners = new Map<PlatformAdapter, string>()
  private readonly logger: MessagingLogger
  private readonly pairing = new PairingCodeManager()
  private readonly whatsAppUiListeners = new Set<(workspaceId: string, event: WhatsAppUiEvent) => void>()
  constructor(private readonly options: MessagingGatewayRegistryOptions) { this.logger = options.logger ?? NOOP }
  setPublisher(publish: NonNullable<MessagingGatewayRegistryOptions['publish']>): void { this.options.publish = publish }
  /** Eagerly create workspace state so hosts can initialize configured workspaces at startup. */
  async initializeWorkspace(workspaceId: string): Promise<void> {
    const state = this.state(workspaceId)
    let config = state.config.get()
    for (const platform of ['telegram', 'lark'] as const) {
      if (config.platforms[platform]?.enabled) continue
      const credential = await this.credentials().get(credentialId(workspaceId, platform)).catch(() => null)
      if (!credential?.value) continue
      config = state.config.update({ enabled: true, platforms: { [platform]: { enabled: true } } })
    }
    for (const platform of platforms) {
      if (config.platforms[platform]?.enabled) await this.connect(workspaceId, platform)
    }
  }
  /** Forward the complete session event stream only to chats already bound by the user. */
  onSessionEvent = (channel: string, target: unknown, ...args: unknown[]): void => {
    if (channel !== 'session:event') return
    const event = args[0]
    if (!event || typeof event !== 'object') return
    const value = event as SessionEvent
    if (typeof value.sessionId !== 'string') return
    const workspaceId = readWorkspaceTarget(target)
    if (!workspaceId) return
    const state = this.workspaces.get(workspaceId)
    if (!state) return
    for (const binding of state.bindings.getAll()) {
      if (!binding.enabled || binding.workspaceId !== workspaceId || binding.sessionId !== value.sessionId) continue
      const adapter = state.adapters[binding.platform]
      if (!adapter?.isConnected()) continue
      void state.renderer.handle(value, binding, adapter).catch(() => {
        this.logger.warn('Messaging outbound delivery failed', { workspaceId, sessionId: value.sessionId, platform: binding.platform })
      })
    }
    if (value.type === 'info' && value.statusType === 'compaction_complete') void this.finishCompact(workspaceId, value.sessionId)
  }
  async stopAll(): Promise<void> { await this.dispose() }
  generatePairingCode(workspaceId: string, sessionId: string, platform: PlatformType): { code: string; expiresAt: number; botUsername?: string } { if (!this.sessionBelongsToWorkspace(workspaceId, sessionId)) throw new Error('Session does not belong to this workspace'); const entry = this.pairing.create(workspaceId, sessionId, platform); return { code: entry.code, expiresAt: entry.expiresAt, botUsername: this.getConfig(workspaceId).platforms[platform]?.botUsername } }
  generateSupergroupPairingCode(workspaceId: string, platform: 'telegram'): { code: string; expiresAt: number; botUsername?: string } { const entry = this.pairing.createSupergroup(workspaceId, platform); return { code: entry.code, expiresAt: entry.expiresAt, botUsername: this.getConfig(workspaceId).platforms.telegram?.botUsername } }
  getWorkspaceSupergroup(workspaceId: string): { chatId: string; title: string; capturedAt: number } | null { const value = this.getConfig(workspaceId).platforms.telegram; return value?.acceptedSupergroupChatId ? { chatId: value.acceptedSupergroupChatId, title: value.acceptedSupergroupTitle ?? value.acceptedSupergroupChatId, capturedAt: value.acceptedSupergroupCapturedAt ?? 0 } : null }
  async unbindWorkspaceSupergroup(workspaceId: string): Promise<void> { const state = this.state(workspaceId); const current = state.config.get(); state.config.update({ platforms: { ...current.platforms, telegram: { ...current.platforms.telegram, acceptedSupergroupChatId: undefined, acceptedSupergroupTitle: undefined, acceptedSupergroupCapturedAt: undefined } } }); this.publish('messaging:bindingChanged', workspaceId) }
  async bindAutomationTopic(workspaceId: string, topicName: string, sessionId?: string): Promise<{ channelId: string; threadId: number }> { const state = this.state(workspaceId); if (sessionId && !this.sessionBelongsToWorkspace(workspaceId, sessionId)) throw new Error('Session does not belong to this workspace'); const supergroup = this.getWorkspaceSupergroup(workspaceId); if (!supergroup) throw new Error('Telegram supergroup is not paired'); const adapter = state.adapters.telegram; if (!adapter?.createForumTopic) throw new Error('Telegram topic creation is unavailable'); const topic = await state.topics.findOrCreate({ workspaceId, platform: 'telegram', name: topicName, channelId: supergroup.chatId }, () => adapter.createForumTopic!(supergroup.chatId, topicName)); if (sessionId && !state.bindings.findByChannel('telegram', topic.channelId, topic.threadId)) { state.bindings.bind({ workspaceId, sessionId, platform: 'telegram', channelId: topic.channelId, threadId: topic.threadId, channelName: topicName }); this.publish('messaging:bindingChanged', workspaceId) } return { channelId: topic.channelId, threadId: topic.threadId } }
  async removeAutomationTopic(workspaceId: string, topicName: string): Promise<void> { const supergroup = this.getWorkspaceSupergroup(workspaceId); if (supergroup) this.state(workspaceId).topics.remove(workspaceId, supergroup.chatId, topicName) }
  async startWhatsAppConnect(workspaceId: string): Promise<void> { this.enablePlatform(workspaceId, 'whatsapp'); await this.connect(workspaceId, 'whatsapp') }
  async submitWhatsAppPhone(workspaceId: string, phoneNumber: string): Promise<void> { const normalized = phoneNumber.replace(/[\s()-]/g, ''); const adapter = this.state(workspaceId).adapters.whatsapp as (PlatformAdapter & { requestPairingCode?: (value: string) => Promise<void> }) | undefined; if (!/^\+?[0-9]{7,20}$/.test(normalized)) throw new Error('A valid WhatsApp phone number is required'); if (!adapter?.requestPairingCode) throw new Error('WhatsApp phone pairing is unavailable'); await adapter.requestPairingCode(normalized) }
  onWhatsAppUiEvent(listener: (workspaceId: string, event: WhatsAppUiEvent) => void): () => void { this.whatsAppUiListeners.add(listener); return () => this.whatsAppUiListeners.delete(listener) }
  getConfig(workspaceId: string): MessagingConfig { return this.state(workspaceId).config.get() }
  async updateConfig(workspaceId: string, patch: Partial<MessagingConfig>): Promise<MessagingConfig> { const config = this.state(workspaceId).config.update(patch); this.publish('messaging:platformStatus', workspaceId, this.getRuntime(workspaceId)); return config }
  getBindings(workspaceId: string): ChannelBinding[] { return this.state(workspaceId).bindings.getAll() }
  bind(workspaceId: string, input: Omit<ChannelBinding, 'id' | 'createdAt' | 'enabled' | 'config' | 'workspaceId'> & { config?: Partial<ChannelBinding['config']> }): ChannelBinding { if (!this.sessionBelongsToWorkspace(workspaceId, input.sessionId)) throw new Error('Session does not belong to this workspace'); const binding = this.state(workspaceId).bindings.bind({ ...input, workspaceId }); this.publish('messaging:bindingChanged', workspaceId); return binding }
  unbindBinding(workspaceId: string, bindingId: string): boolean { const result = this.state(workspaceId).bindings.unbindById(bindingId); if (result) this.publish('messaging:bindingChanged', workspaceId); return result }
  unbindSession(workspaceId: string, sessionId: string, platform?: PlatformType): number { const result = this.state(workspaceId).bindings.unbindSession(sessionId, platform); if (result) this.publish('messaging:bindingChanged', workspaceId); return result }
  setBindingAccess(workspaceId: string, bindingId: string, access: { mode: BindingAccessMode; allowedSenderIds?: string[] }): ChannelBinding | null { const binding = this.state(workspaceId).bindings.setAccess(bindingId, access.mode, access.allowedSenderIds); if (binding) this.publish('messaging:bindingChanged', workspaceId); return binding }
  setPlatformOwners(workspaceId: string, platform: PlatformType, owners: Array<{ userId: string; displayName?: string; username?: string; addedAt: number }>): Array<{ userId: string; displayName?: string; username?: string; addedAt: number }> { const ids = owners.map(owner => owner.userId); const state = this.state(workspaceId); const config = setPlatformOwners(state.config.get(), platform, ids); state.config.update(config); this.publish('messaging:bindingChanged', workspaceId); return normalizeOwners(owners) }
  setPlatformAccessMode(workspaceId: string, platform: PlatformType, mode: 'open' | 'owner-only'): void { const state = this.state(workspaceId); state.config.update({ access: { ...state.config.get().access, [platform]: { mode, ownerIds: state.config.get().access?.[platform]?.ownerIds ?? [] } } }); this.publish('messaging:bindingChanged', workspaceId) }
  getPlatformOwners(workspaceId: string, platform: PlatformType): Array<{ userId: string; addedAt: number }> { return (this.state(workspaceId).config.get().access?.[platform]?.ownerIds ?? []).map(userId => ({ userId, addedAt: 0 })) }
  getPlatformAccessMode(workspaceId: string, platform: PlatformType): 'open' | 'owner-only' { return this.state(workspaceId).config.get().access?.[platform]?.mode ?? 'open' }
  getPendingSenders(workspaceId: string, platform?: PlatformType): PendingSender[] { return this.workspaces.get(workspaceId)?.pending.list(platform) ?? [] }
  dismissPendingSender(workspaceId: string, platform: PlatformType, senderId: string, entryKey: PendingSenderKey): boolean { return this.workspaces.get(workspaceId)?.pending.dismiss(platform, senderId, entryKey) ?? false }
  allowPendingSender(workspaceId: string, platform: PlatformType, senderId: string, entryKey: PendingSenderKey): { owners: Array<{ userId: string; addedAt: number }>; bindingId?: string } {
    const state = this.state(workspaceId)
    const pending = state.pending.find(platform, senderId, entryKey)
    if (!pending) throw new Error('Pending sender not found')
    if (pending.reason === 'not-on-binding-allowlist') {
      const binding = state.bindings.getAll().find(item => item.id === pending.bindingId)
      if (!binding) throw new Error('Binding no longer exists')
      state.bindings.setAccess(binding.id, 'allow-list', [...new Set([...(binding.config.allowedSenderIds ?? []), senderId])])
      state.pending.dismiss(platform, senderId, { reason: pending.reason, bindingId: pending.bindingId })
      this.publish('messaging:bindingChanged', workspaceId)
      return { owners: this.getPlatformOwners(workspaceId, platform), bindingId: binding.id }
    }
    const owners = [...this.getPlatformOwners(workspaceId, platform), { userId: senderId, addedAt: Date.now() }]
    this.setPlatformOwners(workspaceId, platform, owners)
    state.pending.dismiss(platform, senderId, { reason: pending.reason, bindingId: pending.bindingId })
    this.publish('messaging:bindingChanged', workspaceId)
    return { owners: this.getPlatformOwners(workspaceId, platform) }
  }
  async saveCredential(workspaceId: string, platform: PlatformType, value: string): Promise<void> { if (!value.trim()) throw new Error('Credential is required'); await this.credentials().set(credentialId(workspaceId, platform), { value }); this.patchRuntime(workspaceId, platform, { configured: true, state: 'disconnected', connected: false }) }
  async forgetCredential(workspaceId: string, platform: PlatformType): Promise<void> { await this.credentials().delete(credentialId(workspaceId, platform)); this.patchRuntime(workspaceId, platform, { configured: false, state: 'disconnected', connected: false }) }
  async saveTelegramToken(workspaceId: string, token: string): Promise<void> { await this.saveCredential(workspaceId, 'telegram', token); this.enablePlatform(workspaceId, 'telegram'); await this.connect(workspaceId, 'telegram') }
  async saveLarkCredentials(workspaceId: string, credentials: LarkCredentials): Promise<void> { await this.saveCredential(workspaceId, 'lark', JSON.stringify(credentials)); this.enablePlatform(workspaceId, 'lark'); await this.connect(workspaceId, 'lark') }
  async disconnectPlatform(workspaceId: string, platform: PlatformType): Promise<void> { await this.disconnect(workspaceId, platform) }
  async forgetPlatform(workspaceId: string, platform: PlatformType): Promise<void> { await this.disconnect(workspaceId, platform); await this.forgetCredential(workspaceId, platform); const state = this.state(workspaceId); const current = state.config.get(); state.config.update({ platforms: { ...current.platforms, [platform]: { ...current.platforms[platform], enabled: false } } }) }
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
  async connect(workspaceId: string, platform: PlatformType): Promise<void> { const state = this.state(workspaceId); const adapter = state.adapters[platform]; let credential: { value: string } | null = null; try { credential = await this.credentials().get(credentialId(workspaceId, platform)) } catch { this.patchRuntime(workspaceId, platform, { configured: false, connected: false, state: 'disconnected', lastError: 'Credential is unavailable' }); return } const canConnect = platform === 'whatsapp' || Boolean(credential); if (!adapter || !canConnect) { this.patchRuntime(workspaceId, platform, { configured: Boolean(credential) || platform === 'whatsapp', connected: false, state: adapter ? 'disconnected' : 'error', lastError: adapter ? 'Credential is not configured' : 'Platform adapter is unavailable' }); return } if (adapter.isConnected()) { this.patchRuntime(workspaceId, platform, { configured: true, connected: true, state: 'connected', lastError: undefined }); return } this.patchRuntime(workspaceId, platform, { configured: true, connected: false, state: 'connecting', lastError: undefined }); try { adapter.onMessage(async message => { await state.router.route(message, adapter) }); adapter.onButtonPress?.(async press => { await this.handleButtonPress(workspaceId, press) }); adapter.onStatus?.(patch => this.patchRuntime(workspaceId, platform, patch)); adapter.onUiEvent?.(event => this.emitWhatsAppUiEvent(workspaceId, event)); await adapter.initialize({ credential: credential?.value ?? '', config: this.getConfig(workspaceId).platforms[platform] ?? {} }); this.patchRuntime(workspaceId, platform, { configured: true, connected: adapter.isConnected(), state: adapter.isConnected() ? 'connected' : 'connecting' }) } catch { this.patchRuntime(workspaceId, platform, { configured: true, connected: false, state: 'error', lastError: 'Connection failed. Check configuration and provider permissions.' }) } }
  async disconnect(workspaceId: string, platform: PlatformType): Promise<void> { const adapter = this.state(workspaceId).adapters[platform]; if (adapter) await adapter.destroy().then(() => undefined, () => undefined); this.patchRuntime(workspaceId, platform, { connected: false, state: 'disconnected' }) }
  getRuntime(workspaceId: string): PlatformRuntimeInfo[] { return platforms.map(platform => ({ ...this.state(workspaceId).runtime[platform] })) }
  async sendSessionText(workspaceId: string, sessionId: string, text: string): Promise<void> { const state = this.state(workspaceId); const bindings = state.bindings.getAll().filter(binding => binding.enabled && binding.sessionId === sessionId); await Promise.allSettled(bindings.map(binding => state.adapters[binding.platform]?.sendText(binding.channelId, text.slice(0, 30_000), binding.threadId === undefined ? undefined : { threadId: binding.threadId }))) }
  async dispose(): Promise<void> { await Promise.all([...this.workspaces.values()].flatMap(state => Object.values(state.adapters).map(async adapter => { try { await adapter?.destroy() } catch {} }))); this.adapterOwners.clear(); this.workspaces.clear() }
  private state(workspaceId: string): WorkspaceState { let state = this.workspaces.get(workspaceId); if (state) return state; const dir = this.options.getMessagingDir(workspaceId); const config = new ConfigStore(dir, this.logger); const bindings = new BindingStore(dir); const pending = new PendingSenders(dir, 50, () => this.publish('messaging:pendingChanged', workspaceId)); const topics = new TopicRegistry(dir); const planTokens = new PlanTokenRegistry(); const permissionMessages = new Map<string, { bindingId: string; channelId: string; messageId: string }>(); const planMessages = new Map<string, { bindingId: string; channelId: string; messageId: string }>(); const pendingCompact = new Map<string, { bindingId: string; channelId: string; threadId?: number; planPath: string }>(); const renderer = new MessagingRenderer({ planTokens, loadPlan: (sessionId, planPath) => loadSessionPlan(this.options.sessionManager, sessionId, planPath), recordPermissionMessage: (binding, requestId, messageId) => permissionMessages.set(requestId, { bindingId: binding.id, channelId: binding.channelId, messageId }), recordPlanMessage: (binding, token, messageId) => planMessages.set(token, { bindingId: binding.id, channelId: binding.channelId, messageId }) }); const runtime = Object.fromEntries(platforms.map(platform => [platform, { platform, configured: platform === 'whatsapp', connected: false, state: 'disconnected', updatedAt: Date.now() }])) as Record<PlatformType, PlatformRuntimeInfo>; const commands = new Commands({ workspaceId, sessionManager: this.options.sessionManager, bindingStore: bindings, pairing: this.pairing, getConfig: () => config.get(), seedOwnerOnFirstPair: (platform, message) => { const current = config.get(); if (current.access?.[platform]?.ownerIds.length) return true; if (message.chatType !== 'private') return false; config.update(seedFirstPlatformOwner(current, platform, message.senderId)); this.publish('messaging:bindingChanged', workspaceId); return true }, onBindingChanged: () => this.publish('messaging:bindingChanged', workspaceId), onSupergroupPaired: async message => { const adapter = state?.adapters.telegram; const info = await adapter?.getChatInfo?.(message.channelId); if (info && (info.type !== 'supergroup' || info.isForum !== true)) throw new Error('Telegram supergroup must have Topics enabled'); const current = config.get(); config.update({ platforms: { ...current.platforms, telegram: { ...current.platforms.telegram, acceptedSupergroupChatId: message.channelId, acceptedSupergroupTitle: info?.title ?? message.channelName ?? message.channelId, acceptedSupergroupCapturedAt: Date.now() } } }); adapter?.setAcceptedSupergroupChatId?.(message.channelId); this.publish('messaging:bindingChanged', workspaceId) } }); const router = new MessageRouter({ bindingStore: bindings, commands, getConfig: () => config.get(), isSessionInWorkspace: async sessionId => this.sessionBelongsToWorkspace(workspaceId, sessionId), sendToSession: (sessionId, text, attachments) => this.options.sendToSession ? this.options.sendToSession(workspaceId, sessionId, text, attachments) : this.options.sessionManager ? this.options.sessionManager.sendMessage(sessionId, text, attachments) : Promise.reject(new Error('Session manager is unavailable')), logger: this.logger, onUnauthorized: (message, binding, reason) => pending.add({ platform: message.platform, senderId: message.senderId, ...(message.senderName ? { senderName: message.senderName } : {}), bindingId: binding.id, reason, createdAt: Date.now() }) }); const adapters = Object.fromEntries(platforms.map(platform => [platform, this.claimAdapter(this.options.createAdapter?.(platform, workspaceId) ?? this.options.adapters?.[platform] ?? this.createDefaultAdapter(platform, dir), workspaceId)])) as Partial<Record<PlatformType, PlatformAdapter>>; state = { config, bindings, pending, topics, runtime, router, commands, renderer, planTokens, permissionMessages, planMessages, pendingCompact, adapters }; this.workspaces.set(workspaceId, state); return state }
  private async handleButtonPress(workspaceId: string, press: ButtonPress): Promise<void> { const state = this.state(workspaceId); if (press.senderIsBot) return; const binding = state.bindings.findByChannel(press.platform, press.channelId, press.threadId); if (!binding || binding.workspaceId !== workspaceId || !this.sessionBelongsToWorkspace(workspaceId, binding.sessionId) || !isSenderAllowed(state.config.get(), binding, press.senderId)) return; const adapter = state.adapters[press.platform]; if (!adapter?.isConnected()) return; const parts = press.buttonId.split(':'); if (parts[0] === 'perm') { const requestId = parts[2]; const record = requestId ? state.permissionMessages.get(requestId) : undefined; if (!requestId || !record || record.bindingId !== binding.id || (parts[1] !== 'allow' && parts[1] !== 'deny')) return; state.permissionMessages.delete(requestId); await adapter.clearButtons?.(record.channelId, record.messageId).catch(() => undefined); const delivered = this.options.sessionManager?.respondToPermission(binding.sessionId, requestId, parts[1] === 'allow', false) ?? false; if (delivered) await adapter.sendText(press.channelId, parts[1] === 'allow' ? 'Allowed.' : 'Denied.', press.threadId === undefined ? undefined : { threadId: press.threadId }); return } if (parts[0] !== 'plan' || (parts[1] !== 'accept' && parts[1] !== 'compact') || !parts[2]) return; const entry = state.planTokens.resolve(parts[2]); if (!entry || entry.bindingId !== binding.id || entry.sessionId !== binding.sessionId) return; state.planTokens.revoke(parts[2]); const record = state.planMessages.get(parts[2]); state.planMessages.delete(parts[2]); if (record) await adapter.clearButtons?.(record.channelId, record.messageId).catch(() => undefined); if (!this.options.sessionManager) return; if (parts[1] === 'accept') { await this.options.sessionManager.acceptPlan(entry.sessionId, entry.planPath); await adapter.sendText(press.channelId, 'Plan accepted. Agent resuming.', press.threadId === undefined ? undefined : { threadId: press.threadId }); return } state.pendingCompact.set(entry.sessionId, { bindingId: binding.id, channelId: press.channelId, ...(press.threadId === undefined ? {} : { threadId: press.threadId }), planPath: entry.planPath }); await this.options.sessionManager.setPendingPlanExecution(entry.sessionId, entry.planPath); await this.options.sessionManager.sendMessage(entry.sessionId, '/compact'); await adapter.sendText(press.channelId, 'Compacting conversation, then executing the plan.', press.threadId === undefined ? undefined : { threadId: press.threadId }) }
  private async finishCompact(workspaceId: string, sessionId: string): Promise<void> { const state = this.workspaces.get(workspaceId); const pending = state?.pendingCompact.get(sessionId); if (!state || !pending || !this.options.sessionManager) return; const binding = state.bindings.getAll().find(value => value.id === pending.bindingId && value.sessionId === sessionId); if (!binding) { state.pendingCompact.delete(sessionId); return } state.pendingCompact.delete(sessionId); await this.options.sessionManager.acceptPlan(sessionId, pending.planPath); await this.options.sessionManager.clearPendingPlanExecution(sessionId); const adapter = state.adapters[binding.platform]; if (adapter?.isConnected()) await adapter.sendText(pending.channelId, 'Plan executing after compaction.', pending.threadId === undefined ? undefined : { threadId: pending.threadId }) }
  private sessionBelongsToWorkspace(workspaceId: string, sessionId: string): boolean { return this.options.sessionManager ? this.options.sessionManager.getSessions(workspaceId).some(session => session.id === sessionId && session.workspaceId === workspaceId) : Boolean(this.options.sendToSession) }
  private enablePlatform(workspaceId: string, platform: PlatformType): void { const state = this.state(workspaceId); const current = state.config.get(); state.config.update({ enabled: true, platforms: { ...current.platforms, [platform]: { ...current.platforms[platform], enabled: true } } }) }
  private credentials(): MessagingCredentialManager { return this.options.credentialManager ?? getCredentialManager() }
  private createDefaultAdapter(platform: PlatformType, directory: string): PlatformAdapter | undefined { if (platform === 'telegram') return new TelegramAdapter(); if (platform === 'lark') return new LarkAdapter(); if (platform === 'whatsapp' && this.options.whatsapp) return new WhatsAppAdapter({ workerEntry: this.options.whatsapp.workerEntry, authDir: `${directory}/whatsapp`, ...(this.options.whatsapp.nodeBin ? { nodeBin: this.options.whatsapp.nodeBin } : {}), ...(this.options.whatsapp.pairingMode ? { pairingMode: this.options.whatsapp.pairingMode } : {}), ...(this.options.whatsapp.electronRunAsNode === undefined ? {} : { electronRunAsNode: this.options.whatsapp.electronRunAsNode }) }); return undefined }
  private claimAdapter(adapter: PlatformAdapter | undefined, workspaceId: string): PlatformAdapter | undefined { if (!adapter) return undefined; const owner = this.adapterOwners.get(adapter); if (owner && owner !== workspaceId) { this.logger.warn('Messaging adapter instance already belongs to another workspace'); return undefined } this.adapterOwners.set(adapter, workspaceId); return adapter }
  private patchRuntime(workspaceId: string, platform: PlatformType, patch: Partial<PlatformRuntimeInfo>): void { const state = this.state(workspaceId); state.runtime[platform] = { ...state.runtime[platform], ...patch, platform, updatedAt: Date.now() }; this.publish('messaging:platformStatus', workspaceId, { ...state.runtime[platform] }) }
  private emitWhatsAppUiEvent(workspaceId: string, event: WhatsAppUiEvent): void { for (const listener of this.whatsAppUiListeners) listener(workspaceId, event); this.publish('messaging:wa:uiEvent', workspaceId, event) }
  private publish(channel: string, workspaceId: string, payload?: unknown): void { this.options.publish?.(channel, workspaceId, payload) }
}

function credentialId(workspaceId: string, platform: PlatformType): { type: 'source_bearer'; workspaceId: string; sourceId: string } { return { type: 'source_bearer', workspaceId, sourceId: `messaging-${platform}` } }

function normalizeOwners(owners: Array<{ userId: string; displayName?: string; username?: string; addedAt: number }>): Array<{ userId: string; displayName?: string; username?: string; addedAt: number }> { const values = new Map<string, { userId: string; displayName?: string; username?: string; addedAt: number }>(); for (const owner of owners) if (owner?.userId) values.set(owner.userId, { ...owner }); return [...values.values()] }

function readWorkspaceTarget(target: unknown): string | null {
  if (!target || typeof target !== 'object') return null
  const value = target as { to?: unknown; workspaceId?: unknown }
  return value.to === 'workspace' && typeof value.workspaceId === 'string' ? value.workspaceId : null
}

export function loadSessionPlan(sessionManager: MessagingSessionManager | undefined, sessionId: string, planPath: string): string | null {
  if (!sessionManager || !planPath) return null
  try {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return null
    const plansRoot = realpathSync(`${sessionPath}${sep}plans`)
    const resolved = realpathSync(planPath)
    const child = relative(plansRoot, resolved)
    if (!child || child.startsWith(`..${sep}`) || child === '..' || child.includes(`${sep}..${sep}`)) return null
    const info = statSync(resolved)
    if (!info.isFile() || info.size > 1024 * 1024) return null
    return readFileSync(resolved, 'utf8')
  } catch {
    return null
  }
}

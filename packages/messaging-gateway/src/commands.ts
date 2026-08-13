import type { MessagingSessionManager } from './session-manager'
import { isPlatformSenderAllowed, isSenderAllowed } from './access-control'
import type { BindingStore } from './binding-store'
import type { PairingCodeManager } from './pairing'
import type { ChannelBinding, IncomingMessage, MessagingConfig, PlatformAdapter, PlatformType } from './types'

export function parseCommand(text: string): { cmd: string; args: string } {
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i)
  return match ? { cmd: `/${match[1]!.toLowerCase()}`, args: (match[2] ?? '').trim() } : { cmd: '', args: '' }
}

/** Parses a deliberate one-time session pairing command. */
export function consumePairCommand(input: string, workspaceId: string, platform: PlatformType, manager: PairingCodeManager, senderId = ''): { sessionId: string } | null {
  const { cmd, args } = parseCommand(input)
  if (cmd !== '/pair' || !/^\d{6}$/.test(args)) return null
  const value = manager.consume(args, workspaceId, platform, senderId)
  return value?.kind === 'session' && value.sessionId ? { sessionId: value.sessionId } : null
}

export interface CommandDeps {
  workspaceId: string
  sessionManager?: MessagingSessionManager
  bindingStore: BindingStore
  pairing: PairingCodeManager
  getConfig(): MessagingConfig
  seedOwnerOnFirstPair?(platform: PlatformType, message: IncomingMessage): boolean | void
  onBindingChanged?(): void
  onSupergroupPaired?(message: IncomingMessage): Promise<void> | void
}

/** Explicit command path for private chats and a paired Telegram supergroup. */
export class Commands {
  constructor(private readonly deps: CommandDeps) {}

  async handle(adapter: PlatformAdapter, message: IncomingMessage): Promise<boolean> {
    const { cmd, args } = parseCommand(message.text)
    if (!cmd || message.senderIsBot || (cmd !== '/pair' && !this.isAllowedChat(message))) return false
    const options = message.threadId === undefined ? undefined : { threadId: message.threadId }
    if (cmd === '/pair') {
      await this.pair(adapter, message, args, options)
      return true
    }
    const binding = this.deps.bindingStore.findByChannel(adapter.platform, message.channelId, message.threadId)
    const authorized = binding
      ? isSenderAllowed(this.deps.getConfig(), binding, message.senderId)
      : isPlatformSenderAllowed(this.deps.getConfig(), adapter.platform, message.senderId)
    if (!authorized) {
      await adapter.sendText(message.channelId, 'This bot is private. Ask the owner to invite you.', options)
      return true
    }
    if (cmd === '/new') {
      await this.create(adapter, message, args || undefined, options)
      return true
    }
    if (cmd === '/bind') {
      await this.bindExisting(adapter, message, args, options)
      return true
    }
    if (cmd === '/unbind') {
      const removed = this.deps.bindingStore.unbindChannel(adapter.platform, message.channelId, message.threadId)
      if (removed) this.deps.onBindingChanged?.()
      await adapter.sendText(message.channelId, removed ? 'Disconnected from session.' : 'No session is bound to this chat.', options)
      return true
    }
    if (cmd === '/status') {
      const current = this.deps.bindingStore.findByChannel(adapter.platform, message.channelId, message.threadId)
      if (!current) await adapter.sendText(message.channelId, 'No session bound. Use /bind, /new, or /pair.', options)
      else {
        const session = await this.deps.sessionManager?.getSession(current.sessionId)
        await adapter.sendText(message.channelId, `Bound to ${session?.name || current.sessionId}.`, options)
      }
      return true
    }
    if (cmd === '/stop') {
      const current = this.deps.bindingStore.findByChannel(adapter.platform, message.channelId, message.threadId)
      if (!current || !this.deps.sessionManager) await adapter.sendText(message.channelId, 'No session bound.', options)
      else {
        try { await this.deps.sessionManager.cancelProcessing(current.sessionId); await adapter.sendText(message.channelId, 'Stopped.', options) }
        catch { await adapter.sendText(message.channelId, 'Nothing to stop.', options) }
      }
      return true
    }
    if (cmd === '/help') {
      await adapter.sendText(message.channelId, 'Commands:\n/new [name] - create and bind a session\n/bind [number or id] - connect an existing session\n/pair <code> - redeem an app pairing code\n/unbind - disconnect this chat\n/status - show the current binding\n/stop - stop the current run\n/help - show this message', options)
      return true
    }
    await adapter.sendText(message.channelId, 'No session bound to this chat. Use /new, /bind, or /pair.', options)
    return true
  }

  private async pair(adapter: PlatformAdapter, message: IncomingMessage, code: string, options?: { threadId?: number }): Promise<void> {
    if (!/^\d{6}$/.test(code)) {
      await adapter.sendText(message.channelId, 'Use /pair followed by the six-digit code from the app.', options)
      return
    }
    const access = this.deps.getConfig().access?.[adapter.platform]
    const isExistingOwner = Boolean(access?.ownerIds.includes(message.senderId))
    if (access?.ownerIds.length && !isExistingOwner) {
      await adapter.sendText(message.channelId, 'Only an existing owner can use this pairing code.', options)
      return
    }
    if (message.chatType === 'supergroup' && !isExistingOwner) {
      await adapter.sendText(message.channelId, 'Only an existing owner can use this pairing code in a supergroup.', options)
      return
    }
    const entry = this.deps.pairing.consume(code, this.deps.workspaceId, adapter.platform, message.senderId)
    if (!entry) {
      await adapter.sendText(message.channelId, 'That pairing code is invalid, expired, or rate limited.', options)
      return
    }
    if (entry.kind === 'workspace-supergroup') {
      if (adapter.platform !== 'telegram' || message.chatType !== 'supergroup') {
        await adapter.sendText(message.channelId, 'This code must be used in the Telegram supergroup.', options)
        return
      }
      await this.deps.onSupergroupPaired?.(message)
      await adapter.sendText(message.channelId, 'This supergroup is paired with the workspace.', options)
      return
    }
    if (!entry.sessionId) return
    if (this.deps.seedOwnerOnFirstPair?.(adapter.platform, message) === false) {
      await adapter.sendText(message.channelId, 'Unable to establish the first owner. Try again from a private chat.', options)
      return
    }
    this.bind(entry.sessionId, adapter.platform, message)
    this.deps.onBindingChanged?.()
    await adapter.sendText(message.channelId, 'This chat is connected. Send a message to continue.', options)
  }

  private async create(adapter: PlatformAdapter, message: IncomingMessage, name: string | undefined, options?: { threadId?: number }): Promise<void> {
    try {
      if (!this.deps.sessionManager) throw new Error('Session manager is unavailable')
      const session = await this.deps.sessionManager.createSession(this.deps.workspaceId, name ? { name } : undefined)
      this.bind(session.id, adapter.platform, message)
      this.deps.onBindingChanged?.()
      await adapter.sendText(message.channelId, `Created ${session.name || session.id}. Send a message to continue.`, options)
    } catch {
      await adapter.sendText(message.channelId, 'Unable to create a session. Try again from the desktop app.', options)
    }
  }

  private async bindExisting(adapter: PlatformAdapter, message: IncomingMessage, target: string, options?: { threadId?: number }): Promise<void> {
    if (!this.deps.sessionManager) { await adapter.sendText(message.channelId, 'Session manager is unavailable.', options); return }
    const recent = this.deps.sessionManager.getSessions(this.deps.workspaceId)
      .filter(session => !session.isArchived)
      .sort((left, right) => right.lastMessageAt - left.lastMessageAt)
      .slice(0, 10)
    if (!target) {
      if (!recent.length) { await adapter.sendText(message.channelId, 'No sessions found. Use /new to create one.', options); return }
      const lines = recent.map((session, index) => `${index + 1}. ${session.name || session.id.slice(0, 8)} (${session.id.slice(0, 8)})`)
      await adapter.sendText(message.channelId, `Recent sessions:\n${lines.join('\n')}\n\nUse /bind <number> or /bind <session-id>.`, options)
      return
    }
    const selected = /^\d+$/.test(target) && Number(target) >= 1 && Number(target) <= recent.length
      ? recent[Number(target) - 1]
      : await this.deps.sessionManager.getSession(target)
    if (!selected || selected.workspaceId !== this.deps.workspaceId || selected.isArchived) { await adapter.sendText(message.channelId, `Session not found: ${target}`, options); return }
    this.bind(selected.id, adapter.platform, message)
    this.deps.onBindingChanged?.()
    await adapter.sendText(message.channelId, `Bound to ${selected.name || selected.id}.`, options)
  }

  private bind(sessionId: string, platform: PlatformType, message: IncomingMessage): ChannelBinding {
    return this.deps.bindingStore.bind({
      workspaceId: this.deps.workspaceId,
      sessionId,
      platform,
      channelId: message.channelId,
      ...(message.threadId === undefined ? {} : { threadId: message.threadId }),
      ...(message.channelName ? { channelName: message.channelName } : {}),
    })
  }

  private isAllowedChat(message: IncomingMessage): boolean {
    if (message.platform !== 'telegram') return true
    const config = this.deps.getConfig().platforms.telegram
    return message.chatType !== 'supergroup' || config?.acceptedSupergroupChatId === message.channelId
  }
}

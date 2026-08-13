import type { BindingStore } from './binding-store'
import { isSenderAllowed } from './access-control'
import type { Commands } from './commands'
import type { ChannelBinding, IncomingMessage, MessagingConfig, PlatformAdapter } from './types'
import type { PendingSenderReason } from './pending-senders'
import { readFileAttachment } from '@opcagent/shared/utils'
import type { FileAttachment } from '@opcagent/shared/protocol'

export interface MessageRouterDeps {
  bindingStore: BindingStore
  getConfig: () => MessagingConfig
  sendToSession: (sessionId: string, text: string, attachments?: FileAttachment[]) => Promise<void>
  isSessionInWorkspace?: (sessionId: string) => Promise<boolean>
  commands?: Commands
  logger?: { warn(message: string): void }
  onUnauthorized?: (message: IncomingMessage, binding: ChannelBinding, reason: PendingSenderReason) => void
}

/** Routes only already-bound, authorised user input. Unbound inbound traffic is intentionally ignored. */
export class MessageRouter {
  constructor(private readonly deps: MessageRouterDeps) {}
  async route(message: IncomingMessage, adapter?: PlatformAdapter): Promise<boolean> {
    if ((!message.text.trim() && !message.attachments?.length) || message.senderIsBot) return false
    if (message.text.trim() && adapter && await this.deps.commands?.handle(adapter, message)) return true
    const binding = this.deps.bindingStore.findByChannel(message.platform, message.channelId, message.threadId)
    if (!binding) return false
    if (this.deps.isSessionInWorkspace && !await this.deps.isSessionInWorkspace(binding.sessionId)) {
      this.deps.logger?.warn('Messaging binding targets a session outside its workspace')
      return false
    }
    if (!isSenderAllowed(this.deps.getConfig(), binding, message.senderId)) {
      this.deps.onUnauthorized?.(message, binding, rejectionReason(this.deps.getConfig(), binding))
      return false
    }
    try {
      const attachments = (message.attachments ?? [])
        .flatMap(attachment => {
          if (!attachment.localPath) return []
          const value = readFileAttachment(attachment.localPath)
          return value ? [value] : []
        })
      await this.deps.sendToSession(binding.sessionId, message.text, attachments.length ? attachments : undefined)
      return true
    }
    catch { this.deps.logger?.warn('Messaging inbound route failed'); return false }
  }
}

function rejectionReason(config: MessagingConfig, binding: ChannelBinding): PendingSenderReason {
  return binding.config.accessMode === 'allow-list' ? 'not-on-binding-allowlist' : 'not-owner'
}

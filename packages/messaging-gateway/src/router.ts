import type { BindingStore } from './binding-store'
import { isSenderAllowed } from './access-control'
import type { ChannelBinding, IncomingMessage, MessagingConfig } from './types'
import type { PendingSenderReason } from './pending-senders'

export interface MessageRouterDeps {
  bindingStore: BindingStore
  getConfig: () => MessagingConfig
  sendToSession: (sessionId: string, text: string) => Promise<void>
  logger?: { warn(message: string): void }
  onUnauthorized?: (message: IncomingMessage, binding: ChannelBinding, reason: PendingSenderReason) => void
}

/** Routes only already-bound, authorised user input. Unbound inbound traffic is intentionally ignored. */
export class MessageRouter {
  constructor(private readonly deps: MessageRouterDeps) {}
  async route(message: IncomingMessage): Promise<boolean> {
    if (!message.text.trim() || message.senderIsBot) return false
    const binding = this.deps.bindingStore.findByChannel(message.platform, message.channelId, message.threadId)
    if (!binding) return false
    if (!isSenderAllowed(this.deps.getConfig(), binding, message.senderId)) {
      this.deps.onUnauthorized?.(message, binding, rejectionReason(this.deps.getConfig(), binding))
      return false
    }
    try { await this.deps.sendToSession(binding.sessionId, message.text); return true }
    catch { this.deps.logger?.warn('Messaging inbound route failed'); return false }
  }
}

function rejectionReason(config: MessagingConfig, binding: ChannelBinding): PendingSenderReason {
  return binding.config.accessMode === 'allow-list' ? 'not-on-binding-allowlist' : 'not-owner'
}

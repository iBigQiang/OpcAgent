import type { IncomingMessage, MessagingPlatformConfig, PlatformAdapter } from '../../types'

type GrammyBot = {
  command(name: string, handler: (ctx: any) => Promise<void>): void
  on(event: string, handler: (ctx: any) => Promise<void>): void
  api: { sendMessage(chatId: string, text: string, options?: Record<string, unknown>): Promise<unknown>; deleteWebhook(options?: Record<string, unknown>): Promise<unknown> }
  init(): Promise<void>
  start(options?: Record<string, unknown>): Promise<void>
  stop(): void
}

/** Actual grammY polling adapter. It is inert until registry.connect explicitly invokes initialize. */
export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram' as const
  private bot: GrammyBot | null = null
  private connected = false
  private handler: ((message: IncomingMessage) => Promise<void>) | null = null
  onMessage(handler: (message: IncomingMessage) => Promise<void>): void { this.handler = handler }
  async initialize(input: { credential: string; config: MessagingPlatformConfig }): Promise<void> {
    const mod = await dynamicImport('grammy') as { Bot: new (token: string) => GrammyBot }
    const bot = new mod.Bot(input.credential)
    bot.on('message:text', async (ctx: any) => {
      const chat = ctx.chat; const message = ctx.message; const from = ctx.from
      if (!chat || !message || !from || from.is_bot || !isAccepted(chat, input.config.acceptedSupergroupChatId)) return
      await this.handler?.({ platform: 'telegram', channelId: String(chat.id), ...(typeof message.message_thread_id === 'number' ? { threadId: message.message_thread_id } : {}), messageId: String(message.message_id), senderId: String(from.id), senderName: from.first_name, senderUsername: from.username, senderIsBot: Boolean(from.is_bot), text: message.text, timestamp: (message.date ?? Math.floor(Date.now() / 1000)) * 1000 })
    })
    await bot.api.deleteWebhook({ drop_pending_updates: false })
    await bot.init()
    this.bot = bot; this.connected = true
    void bot.start({ drop_pending_updates: false }).catch(() => { this.connected = false })
  }
  async destroy(): Promise<void> { this.bot?.stop(); this.bot = null; this.connected = false; this.handler = null }
  isConnected(): boolean { return this.connected }
  async sendText(channelId: string, text: string, options?: { threadId?: number }): Promise<void> { if (!this.bot) throw new Error('Telegram adapter is not connected'); await this.bot.api.sendMessage(channelId, text, options?.threadId === undefined ? undefined : { message_thread_id: options.threadId }) }
}
function isAccepted(chat: { type?: string; id?: string | number }, supergroupId?: string): boolean { return chat.type === 'private' || (chat.type === 'supergroup' && supergroupId === String(chat.id)) }
async function dynamicImport(name: string): Promise<unknown> { return Function('name', 'return import(name)')(name) as Promise<unknown> }

import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { ButtonPress, IncomingMessage, InlineButton, MessagingPlatformConfig, PlatformAdapter, SentMessage } from '../../types'

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

type GrammyBot = {
  command(name: string, handler: (ctx: any) => Promise<void>): void
  on(event: string, handler: (ctx: any) => Promise<void>): void
  api: { sendMessage(chatId: string, text: string, options?: Record<string, unknown>): Promise<{ message_id?: string | number }>; editMessageText(chatId: string, messageId: string, text: string, options?: Record<string, unknown>): Promise<unknown>; sendChatAction(chatId: string, action: string, options?: Record<string, unknown>): Promise<unknown>; sendDocument(chatId: string, document: { filename: string; source: Buffer }, options?: Record<string, unknown>): Promise<{ message_id?: string | number }>; editMessageReplyMarkup(chatId: string, messageId: string, options?: Record<string, unknown>): Promise<unknown>; getFile(fileId: string): Promise<{ file_path?: string; file_size?: number }>; getChat(chatId: string): Promise<{ id: string | number; title?: string; type?: string; is_forum?: boolean }>; createForumTopic(chatId: string, name: string): Promise<{ message_thread_id: number; name?: string }>; deleteWebhook(options?: Record<string, unknown>): Promise<unknown> }
  init(): Promise<void>
  start(options?: Record<string, unknown>): Promise<void>
  stop(): void
}

/** Actual grammY polling adapter. It is inert until registry.connect explicitly invokes initialize. */
export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram' as const
  readonly capabilities = { messageEditing: true, inlineButtons: true, maxButtons: 8, maxMessageLength: 4096, markdown: 'v2' as const, webhookSupport: true }
  private bot: GrammyBot | null = null
  private connected = false
  private handler: ((message: IncomingMessage) => Promise<void>) | null = null
  private buttonHandler: ((press: ButtonPress) => Promise<void>) | null = null
  private acceptedSupergroupChatId: string | undefined
  private token = ''
  onMessage(handler: (message: IncomingMessage) => Promise<void>): void { this.handler = handler }
  onButtonPress(handler: (press: ButtonPress) => Promise<void>): void { this.buttonHandler = handler }
  async initialize(input: { credential: string; config: MessagingPlatformConfig }): Promise<void> {
    const mod = await dynamicImport('grammy') as { Bot: new (token: string) => GrammyBot }
    this.acceptedSupergroupChatId = input.config.acceptedSupergroupChatId
    this.token = input.credential
    const bot = new mod.Bot(input.credential)
    bot.on('message:text', async (ctx: any) => {
      const chat = ctx.chat; const message = ctx.message; const from = ctx.from
      if (!chat || !message || !from || from.is_bot || !isAccepted(chat, this.acceptedSupergroupChatId)) return
      await this.handler?.({ platform: 'telegram', channelId: String(chat.id), ...(typeof message.message_thread_id === 'number' ? { threadId: message.message_thread_id } : {}), ...(typeof chat.title === 'string' ? { channelName: chat.title } : {}), chatType: chat.type, messageId: String(message.message_id), senderId: String(from.id), senderName: from.first_name, senderUsername: from.username, senderIsBot: Boolean(from.is_bot), text: message.text, timestamp: (message.date ?? Math.floor(Date.now() / 1000)) * 1000 })
    })
    bot.on('callback_query:data', async (ctx: any) => { const query = ctx.callbackQuery; const message = query?.message; const from = query?.from; try { if (!query?.data || !message?.chat || !from || from.is_bot || !isAccepted(message.chat, this.acceptedSupergroupChatId)) return; await this.buttonHandler?.({ platform: 'telegram', channelId: String(message.chat.id), ...(typeof message.message_thread_id === 'number' ? { threadId: message.message_thread_id } : {}), messageId: String(message.message_id), senderId: String(from.id), senderIsBot: Boolean(from.is_bot), buttonId: query.data, data: query.data }) } finally { await ctx.answerCallbackQuery?.().catch?.(() => undefined) } })
    for (const spec of attachmentSpecs) {
      bot.on(`message:${spec.field}`, async (ctx: any) => {
        const chat = ctx.chat; const message = ctx.message; const from = ctx.from
        if (!chat || !message || !from || from.is_bot || !isAccepted(chat, this.acceptedSupergroupChatId)) return
        const value = spec.field === 'photo' ? message.photo?.[message.photo.length - 1] : message[spec.field]
        if (!value?.file_id || (typeof value.file_size === 'number' && value.file_size > MAX_ATTACHMENT_BYTES)) return
        try {
          const downloaded = await this.download(value.file_id, value.file_name ?? spec.defaultName, value.mime_type ?? spec.mimeType)
          await this.handler?.({ platform: 'telegram', channelId: String(chat.id), ...(typeof message.message_thread_id === 'number' ? { threadId: message.message_thread_id } : {}), ...(typeof chat.title === 'string' ? { channelName: chat.title } : {}), chatType: chat.type, messageId: String(message.message_id), senderId: String(from.id), senderName: from.first_name, senderUsername: from.username, senderIsBot: false, text: typeof message.caption === 'string' ? message.caption : '', attachments: [{ type: spec.type, fileId: value.file_id, fileName: downloaded.fileName, mimeType: value.mime_type ?? spec.mimeType, fileSize: downloaded.fileSize, localPath: downloaded.localPath }], timestamp: (message.date ?? Math.floor(Date.now() / 1000)) * 1000 })
        } catch {}
      })
    }
    await bot.api.deleteWebhook({ drop_pending_updates: false })
    await bot.init()
    this.bot = bot; this.connected = true
    void bot.start({ drop_pending_updates: false }).catch(() => { this.connected = false })
  }
  async destroy(): Promise<void> { this.bot?.stop(); this.bot = null; this.connected = false; this.handler = null; this.buttonHandler = null; this.token = '' }
  isConnected(): boolean { return this.connected }
  async sendText(channelId: string, text: string, options?: { threadId?: number }): Promise<SentMessage> { if (!this.bot) throw new Error('Telegram adapter is not connected'); const sent = await this.bot.api.sendMessage(channelId, text, options?.threadId === undefined ? undefined : { message_thread_id: options.threadId }); return { platform: 'telegram', channelId, messageId: String(sent.message_id ?? '') } }
  async editMessage(channelId: string, messageId: string, text: string, options?: { threadId?: number }): Promise<void> { if (!this.bot) throw new Error('Telegram adapter is not connected'); await this.bot.api.editMessageText(channelId, messageId, text, options?.threadId === undefined ? undefined : { message_thread_id: options.threadId }) }
  async sendButtons(channelId: string, text: string, buttons: InlineButton[], options?: { threadId?: number }): Promise<SentMessage> { if (!this.bot) throw new Error('Telegram adapter is not connected'); const sent = await this.bot.api.sendMessage(channelId, text, { ...(options?.threadId === undefined ? {} : { message_thread_id: options.threadId }), reply_markup: { inline_keyboard: buttons.slice(0, this.capabilities.maxButtons).map(button => [{ text: button.label.slice(0, 64), callback_data: button.data ?? button.id }]) } }); return { platform: 'telegram', channelId, messageId: String(sent.message_id ?? '') } }
  async sendTyping(channelId: string, options?: { threadId?: number }): Promise<void> { if (this.bot) await this.bot.api.sendChatAction(channelId, 'typing', options?.threadId === undefined ? undefined : { message_thread_id: options.threadId }) }
  async sendFile(channelId: string, file: Buffer, filename: string, caption?: string, options?: { threadId?: number }): Promise<SentMessage> { if (!this.bot) throw new Error('Telegram adapter is not connected'); const sent = await this.bot.api.sendDocument(channelId, { filename, source: file }, { ...(caption ? { caption } : {}), ...(options?.threadId === undefined ? {} : { message_thread_id: options.threadId }) }); return { platform: 'telegram', channelId, messageId: String(sent.message_id ?? '') } }
  async clearButtons(channelId: string, messageId: string): Promise<void> { if (this.bot) await this.bot.api.editMessageReplyMarkup(channelId, messageId, { reply_markup: { inline_keyboard: [] } }) }
  setAcceptedSupergroupChatId(chatId?: string): void { this.acceptedSupergroupChatId = chatId }
  async getChatInfo(channelId: string) { if (!this.bot) throw new Error('Telegram adapter is not connected'); const chat = await this.bot.api.getChat(channelId); return { id: String(chat.id), ...(chat.title ? { title: chat.title } : {}), ...(chat.type ? { type: chat.type } : {}), ...(typeof chat.is_forum === 'boolean' ? { isForum: chat.is_forum } : {}) } }
  async createForumTopic(channelId: string, name: string): Promise<{ threadId: number; name?: string }> { if (!this.bot) throw new Error('Telegram adapter is not connected'); const topic = await this.bot.api.createForumTopic(channelId, name); return { threadId: topic.message_thread_id, ...(topic.name ? { name: topic.name } : {}) } }
  private async download(fileId: string, fallbackName: string, mimeType?: string): Promise<{ localPath: string; fileName: string; fileSize: number }> {
    if (!this.bot || !this.token) throw new Error('Telegram adapter is not connected')
    const remote = await this.bot.api.getFile(fileId)
    if (!remote.file_path || (typeof remote.file_size === 'number' && remote.file_size > MAX_ATTACHMENT_BYTES)) throw new Error('Telegram attachment is unavailable or too large')
    const extension = extname(remote.file_path) || mimeExtension(mimeType)
    const safeBase = fallbackName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'attachment'
    const fileName = extname(safeBase) || !extension ? safeBase : `${safeBase}${extension}`
    const response = await fetch(`https://api.telegram.org/file/bot${this.token}/${remote.file_path}`)
    if (!response.ok) throw new Error('Telegram attachment download failed')
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Telegram attachment is too large')
    const localPath = join(tmpdir(), `mkagent-telegram-${randomUUID()}-${fileName}`)
    await writeFile(localPath, buffer)
    return { localPath, fileName, fileSize: buffer.byteLength }
  }
}
function isAccepted(chat: { type?: string; id?: string | number }, supergroupId?: string): boolean { return chat.type === 'private' || (chat.type === 'supergroup' && supergroupId === String(chat.id)) }
const attachmentSpecs: Array<{ field: 'photo' | 'document' | 'voice' | 'video' | 'audio'; type: 'photo' | 'document' | 'voice' | 'video' | 'audio'; defaultName: string; mimeType?: string }> = [
  { field: 'photo', type: 'photo', defaultName: 'photo.jpg', mimeType: 'image/jpeg' },
  { field: 'document', type: 'document', defaultName: 'document.bin' },
  { field: 'voice', type: 'voice', defaultName: 'voice.ogg', mimeType: 'audio/ogg' },
  { field: 'video', type: 'video', defaultName: 'video.mp4', mimeType: 'video/mp4' },
  { field: 'audio', type: 'audio', defaultName: 'audio.mp3', mimeType: 'audio/mpeg' },
]
function mimeExtension(mimeType?: string): string { if (mimeType === 'image/jpeg') return '.jpg'; if (mimeType === 'image/png') return '.png'; if (mimeType === 'audio/ogg') return '.ogg'; if (mimeType === 'audio/mpeg') return '.mp3'; if (mimeType === 'video/mp4') return '.mp4'; return '.bin' }
async function dynamicImport(name: string): Promise<unknown> { return Function('name', 'return import(name)')(name) as Promise<unknown> }

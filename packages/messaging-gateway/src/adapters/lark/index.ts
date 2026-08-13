import { randomUUID } from 'node:crypto'
import { stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildClearedCard, buildLarkCard } from './card'
import type { ButtonPress, IncomingMessage, InlineButton, MessagingPlatformConfig, PlatformAdapter, SentMessage } from '../../types'

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export interface LarkCredentials { appId: string; appSecret: string; domain: 'lark' | 'feishu' }
export function parseLarkCredentials(value: string): LarkCredentials { const parsed = JSON.parse(value) as Partial<LarkCredentials>; if (!parsed.appId || !parsed.appSecret || (parsed.domain !== 'lark' && parsed.domain !== 'feishu')) throw new Error('Lark credential must include appId, appSecret and domain'); return parsed as LarkCredentials }

/** Actual Lark/Feishu long-connection adapter; event API is activated only after explicit connect. */
export class LarkAdapter implements PlatformAdapter {
  readonly platform = 'lark' as const
  readonly capabilities = { messageEditing: true, inlineButtons: true, maxButtons: 10, maxMessageLength: 30_000, markdown: 'lark-post' as const, webhookSupport: false }
  private client: any = null
  private wsClient: any = null
  private connected = false
  private handler: ((message: IncomingMessage) => Promise<void>) | null = null
  private buttonHandler: ((press: ButtonPress) => Promise<void>) | null = null
  onMessage(handler: (message: IncomingMessage) => Promise<void>): void { this.handler = handler }
  onButtonPress(handler: (press: ButtonPress) => Promise<void>): void { this.buttonHandler = handler }
  async initialize(input: { credential: string; config: MessagingPlatformConfig }): Promise<void> {
    const sdk = await dynamicImport('@larksuiteoapi/node-sdk') as any
    const credential = parseLarkCredentials(input.credential)
    const domain = credential.domain === 'feishu' ? sdk.Domain.Feishu : sdk.Domain.Lark
    this.client = new sdk.Client({ appId: credential.appId, appSecret: credential.appSecret, domain })
    this.wsClient = new sdk.WSClient({ appId: credential.appId, appSecret: credential.appSecret, domain })
    const dispatcher = new sdk.EventDispatcher({}).register({ 'im.message.receive_v1': async (event: any) => this.receive(event), 'card.action.trigger': async (event: any) => this.receiveAction(event) })
    await this.wsClient.start({ eventDispatcher: dispatcher })
    this.connected = true
  }
  async destroy(): Promise<void> { this.connected = false; this.handler = null; this.buttonHandler = null; await this.wsClient?.stop?.().catch?.(() => {}); this.wsClient = null; this.client = null }
  isConnected(): boolean { return this.connected }
  async sendText(channelId: string, text: string): Promise<SentMessage> { if (!this.client) throw new Error('Lark adapter is not connected'); const result = await this.client.im.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: channelId, msg_type: 'text', content: JSON.stringify({ text }) } }); return { platform: 'lark', channelId, messageId: String(result?.data?.message_id ?? '') } }
  async editMessage(_channelId: string, messageId: string, text: string): Promise<void> { if (!this.client) throw new Error('Lark adapter is not connected'); await this.client.im.message.patch({ path: { message_id: messageId }, data: { content: JSON.stringify({ text }) } }) }
  async sendButtons(channelId: string, text: string, buttons: InlineButton[]): Promise<SentMessage> { if (!this.client) throw new Error('Lark adapter is not connected'); const created = await this.client.im.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: channelId, msg_type: 'interactive', content: JSON.stringify(buildLarkCard(text, buttons)) } }); const messageId = String(created?.data?.message_id ?? ''); if (!messageId) throw new Error('Lark message creation returned no message ID'); await this.client.im.message.patch({ path: { message_id: messageId }, data: { content: JSON.stringify(buildLarkCard(text, buttons, messageId)) } }); return { platform: 'lark', channelId, messageId } }
  async sendFile(channelId: string, file: Buffer, filename: string, caption?: string): Promise<SentMessage> { if (!this.client) throw new Error('Lark adapter is not connected'); const isImage = /\.(jpe?g|png|gif|webp|bmp)$/i.test(filename); const upload = isImage ? await this.client.im.image.create({ data: { image_type: 'message', image: file } }) : await this.client.im.file.create({ data: { file_type: 'stream', file_name: filename, file } }); const key = isImage ? upload?.data?.image_key ?? upload?.image_key : upload?.data?.file_key ?? upload?.file_key; if (!key) throw new Error('Lark upload returned no resource key'); const result = await this.client.im.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: channelId, msg_type: isImage ? 'image' : 'file', content: JSON.stringify(isImage ? { image_key: key } : { file_key: key }) } }); if (caption) await this.sendText(channelId, caption); return { platform: 'lark', channelId, messageId: String(result?.data?.message_id ?? '') } }
  async clearButtons(_channelId: string, messageId: string): Promise<void> { if (this.client) await this.client.im.message.patch({ path: { message_id: messageId }, data: { content: JSON.stringify(buildClearedCard('Action completed')) } }) }
  private async receive(event: any): Promise<void> { const message = event?.message; const sender = event?.sender?.sender_id; const senderId = sender?.open_id ?? sender?.user_id ?? sender?.union_id; if (!message?.message_id || !message?.chat_id || !senderId) return; const chatType = message.chat_type === 'p2p' ? 'private' : 'group'; if (message.message_type === 'text') { let text = ''; try { text = JSON.parse(message.content).text ?? '' } catch {} if (!text) return; await this.handler?.({ platform: 'lark', channelId: String(message.chat_id), chatType, messageId: String(message.message_id), senderId: String(senderId), text, timestamp: parseTimestamp(message.create_time), raw: undefined }); return } if (message.message_type !== 'image' && message.message_type !== 'file') return; let content: { image_key?: string; file_key?: string; file_name?: string }; try { content = JSON.parse(message.content) } catch { return } const fileId = message.message_type === 'image' ? content.image_key : content.file_key; if (!fileId) return; const fileName = sanitizeName(content.file_name ?? (message.message_type === 'image' ? 'image.jpg' : 'file.bin')); try { const localPath = await this.download(message.message_id, fileId, fileName, message.message_type === 'image'); await this.handler?.({ platform: 'lark', channelId: String(message.chat_id), chatType, messageId: String(message.message_id), senderId: String(senderId), text: '', attachments: [{ type: message.message_type === 'image' ? 'photo' : 'document', fileId, fileName, localPath }], timestamp: parseTimestamp(message.create_time), raw: undefined }) } catch {} }
  private async receiveAction(event: any): Promise<void> { const action = event?.action?.value; const context = event?.context; const sender = event?.operator?.operator_id?.open_id ?? event?.operator?.open_id ?? event?.open_id; const id = typeof action?.buttonId === 'string' ? action.buttonId : typeof action?.id === 'string' ? action.id : undefined; const messageId = typeof action?.messageId === 'string' && action.messageId ? action.messageId : context?.open_message_id; if (!id || !sender || !messageId || !context?.open_chat_id) return; await this.buttonHandler?.({ platform: 'lark', channelId: String(context.open_chat_id), messageId: String(messageId), senderId: String(sender), buttonId: id, ...(typeof action?.data === 'string' ? { data: action.data } : {}) }) }
  private async download(messageId: string, fileId: string, filename: string, isImage: boolean): Promise<string> { if (!this.client) throw new Error('Lark adapter is not connected'); const resource = await this.client.im.message.resource.get({ path: { message_id: messageId, file_key: fileId }, params: { type: isImage ? 'image' : 'file' } }); const localPath = join(tmpdir(), `mkagent-lark-${randomUUID()}-${filename}`); if (typeof resource?.writeFile === 'function') await resource.writeFile(localPath); else { const body = Buffer.isBuffer(resource) ? resource : Buffer.from(resource?.data ?? []); if (body.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Lark attachment is too large'); await writeFile(localPath, body) } const info = await stat(localPath); if (info.size > MAX_ATTACHMENT_BYTES) throw new Error('Lark attachment is too large'); return localPath }
}
function sanitizeName(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'attachment.bin' }
function parseTimestamp(value: unknown): number { const number = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value); return Number.isFinite(number) && number > 0 ? number : Date.now() }
async function dynamicImport(name: string): Promise<unknown> { return Function('name', 'return import(name)')(name) as Promise<unknown> }

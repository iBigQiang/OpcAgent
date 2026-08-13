import type { IncomingMessage, MessagingPlatformConfig, PlatformAdapter } from '../../types'

export interface LarkCredentials { appId: string; appSecret: string; domain: 'lark' | 'feishu' }
export function parseLarkCredentials(value: string): LarkCredentials { const parsed = JSON.parse(value) as Partial<LarkCredentials>; if (!parsed.appId || !parsed.appSecret || (parsed.domain !== 'lark' && parsed.domain !== 'feishu')) throw new Error('Lark credential must include appId, appSecret and domain'); return parsed as LarkCredentials }

/** Actual Lark/Feishu long-connection adapter; event API is activated only after explicit connect. */
export class LarkAdapter implements PlatformAdapter {
  readonly platform = 'lark' as const
  private client: any = null
  private wsClient: any = null
  private connected = false
  private handler: ((message: IncomingMessage) => Promise<void>) | null = null
  onMessage(handler: (message: IncomingMessage) => Promise<void>): void { this.handler = handler }
  async initialize(input: { credential: string; config: MessagingPlatformConfig }): Promise<void> {
    const sdk = await dynamicImport('@larksuiteoapi/node-sdk') as any
    const credential = parseLarkCredentials(input.credential)
    const domain = credential.domain === 'feishu' ? sdk.Domain.Feishu : sdk.Domain.Lark
    this.client = new sdk.Client({ appId: credential.appId, appSecret: credential.appSecret, domain })
    this.wsClient = new sdk.WSClient({ appId: credential.appId, appSecret: credential.appSecret, domain })
    const dispatcher = new sdk.EventDispatcher({}).register({ 'im.message.receive_v1': async (event: any) => this.receive(event) })
    await this.wsClient.start({ eventDispatcher: dispatcher })
    this.connected = true
  }
  async destroy(): Promise<void> { this.connected = false; this.handler = null; await this.wsClient?.stop?.().catch?.(() => {}); this.wsClient = null; this.client = null }
  isConnected(): boolean { return this.connected }
  async sendText(channelId: string, text: string): Promise<void> { if (!this.client) throw new Error('Lark adapter is not connected'); await this.client.im.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: channelId, msg_type: 'text', content: JSON.stringify({ text }) } }) }
  private async receive(event: any): Promise<void> { const message = event?.message; const sender = event?.sender?.sender_id; if (!message?.message_id || !message?.chat_id || !sender?.open_id || message.message_type !== 'text') return; let text = ''; try { text = JSON.parse(message.content).text ?? '' } catch {} if (!text) return; await this.handler?.({ platform: 'lark', channelId: String(message.chat_id), messageId: String(message.message_id), senderId: String(sender.open_id), text, timestamp: Date.now(), raw: undefined }) }
}
async function dynamicImport(name: string): Promise<unknown> { return Function('name', 'return import(name)')(name) as Promise<unknown> }

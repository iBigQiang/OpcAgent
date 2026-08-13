import type { PlatformAdapter } from './types'
/** Bounded final-response renderer. Streaming UI may call this repeatedly; adapter owns actual wire formatting. */
export class MessagingRenderer { constructor(private readonly adapter: PlatformAdapter) {} async renderText(channelId: string, text: string, threadId?: number): Promise<void> { const bounded = text.slice(0, 30_000); if (bounded) await this.adapter.sendText(channelId, bounded, threadId === undefined ? undefined : { threadId }) } }

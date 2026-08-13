import { extractText, shouldAcceptInbound } from './filter'
import type { WorkerEvent } from './protocol'

export function processUpsert(messages: Array<{ key?: { remoteJid?: string; id?: string; participant?: string; fromMe?: boolean }; message?: unknown; pushName?: string }>, selfJid?: string): WorkerEvent[] {
  const result: WorkerEvent[] = []
  for (const message of messages) {
    if (!shouldAcceptInbound(message, selfJid)) continue
    const text = extractText(message as Record<string, unknown>)
    if (!text) continue
    result.push({ type: 'incoming', channelId: message.key!.remoteJid!, messageId: message.key!.id!, senderId: message.key!.participant ?? message.key!.remoteJid!, senderName: message.pushName, text, timestamp: Date.now() })
  }
  return result
}

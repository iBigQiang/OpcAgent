import { extractText, shouldAcceptInbound } from './filter'
import type { WorkerEvent } from './protocol'

export function processUpsert(messages: Array<{ key?: { remoteJid?: string; id?: string; participant?: string; fromMe?: boolean }; message?: unknown; pushName?: string }>, selfJid?: string, allowedGroupJids: readonly string[] = []): WorkerEvent[] {
  const result: WorkerEvent[] = []
  for (const message of messages) {
    if (!shouldAcceptInbound(message, selfJid, allowedGroupJids)) continue
    const text = extractText(message as Record<string, unknown>)
    if (!text && !hasSupportedMedia(message.message)) continue
    const group = message.key!.remoteJid!.endsWith('@g.us')
    const senderId = group ? message.key!.participant : message.key!.participant ?? message.key!.remoteJid!
    if (!senderId) continue
    result.push({ type: 'incoming', channelId: message.key!.remoteJid!, chatType: group ? 'group' : 'private', messageId: message.key!.id!, senderId, senderName: message.pushName, text, timestamp: Date.now() })
  }
  return result
}

function hasSupportedMedia(value: unknown): boolean { if (!value || typeof value !== 'object') return false; const message = value as Record<string, unknown>; return Boolean(message.imageMessage || message.documentMessage || message.audioMessage || message.videoMessage) }

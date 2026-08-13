export function bareJid(jid: string | undefined | null): string | null { return jid ? jid.replace(/:\d+@/, '@') : null }
export function extractText(message: Record<string, unknown>): string {
  const content = message.message as Record<string, unknown> | undefined
  if (!content) return ''
  if (typeof content.conversation === 'string') return content.conversation
  const extended = content.extendedTextMessage as Record<string, unknown> | undefined
  return typeof extended?.text === 'string' ? extended.text : ''
}
export function shouldAcceptInbound(message: { key?: { fromMe?: boolean; remoteJid?: string; id?: string }; message?: unknown }, selfJid?: string): boolean {
  const jid = bareJid(message.key?.remoteJid)
  return Boolean(jid && message.key?.id && !message.key?.fromMe && jid !== bareJid(selfJid))
}

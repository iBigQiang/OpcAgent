export type WorkerCommand =
  | { type: 'start'; authDir: string; pairingMode: 'qr' | 'code' }
  | { type: 'send_text'; requestId: string; channelId: string; text: string }
  | { type: 'shutdown' }
export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'connected'; jid?: string }
  | { type: 'qr'; value: string }
  | { type: 'disconnected'; reason?: string }
  | { type: 'incoming'; channelId: string; messageId: string; senderId: string; senderName?: string; text: string; timestamp: number }
  | { type: 'send_result'; requestId: string; messageId?: string; error?: string }
  | { type: 'unavailable'; reason: 'baileys_load_failed' | 'auth_state_error' | 'reconnect_exhausted' | 'unknown'; message: string }
  | { type: 'error'; message: string }
export function encodeMessage(message: WorkerCommand | WorkerEvent): string { return `${JSON.stringify(message)}\n` }
export function parseFrames<T>(buffer: string): { messages: T[]; rest: string } { const lines = buffer.split('\n'); const rest = lines.pop() ?? ''; const messages: T[] = []; for (const line of lines) { if (!line) continue; try { messages.push(JSON.parse(line) as T) } catch {} } return { messages, rest } }

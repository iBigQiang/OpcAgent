import { mkdirSync } from 'node:fs'
import { parseFrames, encodeMessage, type WorkerCommand, type WorkerEvent } from './protocol'
import { processUpsert } from './upsert'
import { writeMediaAttachment } from './media'

type Baileys = {
  default?: (options: any) => any
  makeWASocket?: (options: any) => any
  useMultiFileAuthState(path: string): Promise<{ state: any; saveCreds: () => Promise<void> }>
  fetchLatestBaileysVersion(): Promise<{ version: number[] }>
  downloadMediaMessage(message: any, type: 'buffer', options: Record<string, unknown>): Promise<Buffer>
  DisconnectReason: { loggedOut: number }
}

let socket: any = null
let shuttingDown = false
let buffered = ''
let allowedGroupJids: string[] = []
let lastStart: Extract<WorkerCommand, { type: 'start' }> | null = null
let reconnectAttempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let starting = false
const MAX_RECONNECT_ATTEMPTS = 10
const emit = (event: WorkerEvent): void => { process.stdout.write(encodeMessage(event)) }
const log = (...args: unknown[]) => process.stderr.write(`[mkagent-whatsapp-worker] ${args.map(String).join(' ')}\n`)

async function loadBaileys(): Promise<Baileys | null> { try { return await import('@whiskeysockets/baileys') as unknown as Baileys } catch { return null } }

async function start(command: Extract<WorkerCommand, { type: 'start' }>): Promise<void> {
  if (starting || shuttingDown) return
  starting = true
  lastStart = command
  allowedGroupJids = command.allowedGroupJids ?? []
  const baileys = await loadBaileys()
  if (!baileys) { starting = false; emit({ type: 'unavailable', reason: 'baileys_load_failed', message: 'WhatsApp library is unavailable' }); return }
  try {
    mkdirSync(command.authDir, { recursive: true })
    const { state, saveCreds } = await baileys.useMultiFileAuthState(command.authDir)
    const version = await baileys.fetchLatestBaileysVersion().catch(() => ({ version: [] }))
    const makeSocket = baileys.makeWASocket ?? baileys.default
    if (!makeSocket) { emit({ type: 'unavailable', reason: 'baileys_load_failed', message: 'Baileys socket factory is unavailable' }); return }
    const current = makeSocket({ auth: state, version: version.version, printQRInTerminal: false, ...(command.pairingMode === 'code' ? { mobile: false } : {}), logger: { level: 'silent', child: () => ({ level: 'silent' }) } })
    socket = current
    current.ev.on('creds.update', () => void saveCreds().catch(() => log('failed to persist credentials')))
    current.ev.on('connection.update', (update: any) => {
      if (typeof update.qr === 'string') emit({ type: 'qr', value: update.qr })
      if (update.connection === 'open') { reconnectAttempts = 0; emit({ type: 'connected', jid: current.user?.id }); return }
      if (update.connection !== 'close' || socket !== current) return
      socket = null
      const status = Number(update?.lastDisconnect?.error?.output?.statusCode)
      const loggedOut = status === baileys.DisconnectReason.loggedOut
      if (shuttingDown || loggedOut) { emit({ type: 'disconnected', reason: loggedOut ? 'logged_out' : 'connection_closed' }); return }
      scheduleReconnect()
    })
    current.ev.on('messages.upsert', (upsert: any) => {
      void (async () => {
        for (const message of upsert.messages ?? []) {
          for (const event of processUpsert([message], current.user?.id, allowedGroupJids)) {
            if (event.type === 'incoming') event.attachments = await downloadAttachments(baileys, message)
            if (event.type === 'incoming' && !event.text && !event.attachments?.length) continue
            emit(event)
          }
        }
      })().catch(() => undefined)
    })
    emit({ type: 'ready' })
  } catch { emit({ type: 'unavailable', reason: 'auth_state_error', message: 'Unable to initialise WhatsApp auth state' }) }
  finally { starting = false }
}

function scheduleReconnect(): void {
  if (shuttingDown || reconnectTimer || !lastStart) return
  reconnectAttempts++
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) { emit({ type: 'unavailable', reason: 'reconnect_exhausted', message: 'WhatsApp reconnect attempts were exhausted' }); return }
  emit({ type: 'disconnected', reason: 'connection_closed' })
  const delay = Math.min(1_000 * 2 ** (reconnectAttempts - 1), 30_000)
  reconnectTimer = setTimeout(() => { reconnectTimer = null; if (lastStart) void start(lastStart) }, delay)
}

async function downloadAttachments(baileys: Baileys, message: any): Promise<Extract<WorkerEvent, { type: 'incoming' }>['attachments']> {
  const content = message?.message as Record<string, any> | undefined
  if (!content) return undefined
  const variants = [
    ['imageMessage', 'photo', 'image.jpg'],
    ['documentMessage', 'document', 'document.bin'],
    ['videoMessage', 'video', 'video.mp4'],
    ['audioMessage', content.audioMessage?.ptt === true ? 'voice' : 'audio', content.audioMessage?.ptt === true ? 'voice.ogg' : 'audio.bin'],
  ] as const
  for (const [field, type, fallback] of variants) {
    const node = content[field]
    if (!node) continue
    if (Number(node.fileLength ?? 0) > 20 * 1024 * 1024) return undefined
    try {
      const buffer = await baileys.downloadMediaMessage(message, 'buffer', {})
      const file = await writeMediaAttachment(buffer, node.fileName ?? fallback)
      return [{ type, fileId: String(message.key?.id ?? ''), fileName: file.filename, mimeType: node.mimetype, fileSize: file.size, localPath: file.localPath }]
    } catch { return undefined }
  }
  return undefined
}

async function handle(command: WorkerCommand): Promise<void> {
  if (command.type === 'start') return start(command)
  if (command.type === 'shutdown') { shuttingDown = true; if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = null; socket?.end?.(); socket = null; return }
  if (command.type === 'request_pairing_code') {
    if (!socket?.requestPairingCode) { emit({ type: 'error', message: 'WhatsApp phone pairing is unavailable' }); return }
    try { emit({ type: 'pairing_code', code: await socket.requestPairingCode(command.phoneNumber.replace(/\D/g, '')) }) }
    catch { emit({ type: 'error', message: 'Unable to request WhatsApp pairing code' }) }
    return
  }
  if (!socket) { emit({ type: 'send_result', requestId: command.requestId, error: 'WhatsApp is not connected' }); return }
  try { const result = command.type === 'send_media' ? await socket.sendMessage(command.channelId, { document: Buffer.from(command.data, 'base64'), fileName: command.filename, ...(command.caption ? { caption: command.caption } : {}) }) : await socket.sendMessage(command.channelId, { text: command.text }); emit({ type: 'send_result', requestId: command.requestId, messageId: result?.key?.id }) }
  catch { emit({ type: 'send_result', requestId: command.requestId, error: 'WhatsApp send failed' }) }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { const parsed = parseFrames<WorkerCommand>(buffered + chunk); buffered = parsed.rest; for (const command of parsed.messages) void handle(command) })
process.on('SIGTERM', () => { shuttingDown = true; if (reconnectTimer) clearTimeout(reconnectTimer); socket?.end?.(); process.exit(0) })

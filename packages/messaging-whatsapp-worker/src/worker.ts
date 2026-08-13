import { mkdirSync } from 'node:fs'
import { parseFrames, encodeMessage, type WorkerCommand, type WorkerEvent } from './protocol'
import { processUpsert } from './upsert'

type Baileys = { default?: (options: any) => any; makeWASocket?: (options: any) => any; useMultiFileAuthState(path: string): Promise<{ state: any; saveCreds: () => Promise<void> }>; fetchLatestBaileysVersion(): Promise<{ version: number[] }>; DisconnectReason: { loggedOut: number } }
let socket: any = null
let shuttingDown = false
let buffered = ''
const emit = (event: WorkerEvent): void => { process.stdout.write(encodeMessage(event)) }
const log = (...args: unknown[]) => process.stderr.write(`[mkagent-whatsapp-worker] ${args.map(String).join(' ')}\n`)

async function loadBaileys(): Promise<Baileys | null> { try { return await import('@whiskeysockets/baileys') as unknown as Baileys } catch { return null } }
async function start(command: Extract<WorkerCommand, { type: 'start' }>): Promise<void> {
  const baileys = await loadBaileys(); if (!baileys) { emit({ type: 'unavailable', reason: 'baileys_load_failed', message: 'WhatsApp library is unavailable' }); return }
  try {
    mkdirSync(command.authDir, { recursive: true })
    const { state, saveCreds } = await baileys.useMultiFileAuthState(command.authDir)
    const version = await baileys.fetchLatestBaileysVersion().catch(() => ({ version: [] }))
    const makeSocket = baileys.makeWASocket ?? baileys.default
    if (!makeSocket) { emit({ type: 'unavailable', reason: 'baileys_load_failed', message: 'Baileys socket factory is unavailable' }); return }
    socket = makeSocket({ auth: state, version: version.version, printQRInTerminal: false, logger: { level: 'silent', child: () => ({ level: 'silent' }) } })
    socket.ev.on('creds.update', () => void saveCreds().catch(() => log('failed to persist credentials')))
    socket.ev.on('connection.update', (update: any) => { if (typeof update.qr === 'string') emit({ type: 'qr', value: update.qr }); if (update.connection === 'open') emit({ type: 'connected', jid: socket.user?.id }); if (update.connection === 'close') { socket = null; if (!shuttingDown) emit({ type: 'disconnected', reason: 'connection_closed' }) } })
    socket.ev.on('messages.upsert', (upsert: any) => { for (const event of processUpsert(upsert.messages ?? [], socket.user?.id)) emit(event) })
    emit({ type: 'ready' })
  } catch { emit({ type: 'unavailable', reason: 'auth_state_error', message: 'Unable to initialise WhatsApp auth state' }) }
}
async function handle(command: WorkerCommand): Promise<void> { if (command.type === 'start') return start(command); if (command.type === 'shutdown') { shuttingDown = true; socket?.end?.(); socket = null; return } if (!socket) { emit({ type: 'send_result', requestId: command.requestId, error: 'WhatsApp is not connected' }); return } try { const result = await socket.sendMessage(command.channelId, { text: command.text }); emit({ type: 'send_result', requestId: command.requestId, messageId: result?.key?.id }) } catch { emit({ type: 'send_result', requestId: command.requestId, error: 'WhatsApp send failed' }) } }
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { const parsed = parseFrames<WorkerCommand>(buffered + chunk); buffered = parsed.rest; for (const command of parsed.messages) void handle(command) })
process.on('SIGTERM', () => { shuttingDown = true; socket?.end?.(); process.exit(0) })

import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { parseFrames, encodeMessage, type WorkerCommand, type WorkerEvent } from '@mkagent/messaging-whatsapp-worker'
import type { IncomingMessage, MessagingPlatformConfig, PlatformAdapter, PlatformRuntimeInfo, SentMessage, WhatsAppUiEvent } from '../../types'

/**
 * Baileys runs only in a separately spawned Node worker. This is an unofficial
 * WhatsApp integration; operators must assess account and provider-policy risk.
 */
export class WhatsAppAdapter implements PlatformAdapter {
  readonly platform = 'whatsapp' as const
  readonly capabilities = { messageEditing: false, inlineButtons: false, maxButtons: 0, maxMessageLength: 65_536, markdown: 'whatsapp' as const, webhookSupport: false }
  private proc: ChildProcess | null = null
  private connected = false
  private handler: ((message: IncomingMessage) => Promise<void>) | null = null
  private statusHandler: ((patch: Partial<PlatformRuntimeInfo>) => void) | null = null
  private uiEventHandler: ((event: WhatsAppUiEvent) => void) | null = null
  private buffer = ''
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private restartAttempts = 0
  private disposing = false
  private pairingMode: 'qr' | 'code' = 'qr'
  private allowedGroupJids: string[] = []
  private readonly pendingSends = new Map<string, { channelId: string; resolve(value: SentMessage): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  constructor(private readonly options: { workerEntry: string; authDir: string; nodeBin?: string; electronRunAsNode?: boolean; pairingMode?: 'qr' | 'code' }) {}
  onMessage(handler: (message: IncomingMessage) => Promise<void>): void { this.handler = handler }
  onStatus(handler: (patch: Partial<PlatformRuntimeInfo>) => void): void { this.statusHandler = handler }
  onUiEvent(handler: (event: WhatsAppUiEvent) => void): void { this.uiEventHandler = handler }
  async initialize(input: { credential: string; config: MessagingPlatformConfig }): Promise<void> {
    if (this.proc) return
    this.disposing = false
    this.restartAttempts = 0
    this.pairingMode = this.options.pairingMode ?? 'qr'
    this.allowedGroupJids = input.config.allowedGroupJids?.slice() ?? []
    this.startWorker()
  }
  async destroy(): Promise<void> {
    this.disposing = true
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    const proc = this.proc
    this.proc = null
    this.connected = false
    for (const pending of this.pendingSends.values()) { clearTimeout(pending.timer); pending.reject(new Error('WhatsApp adapter stopped')) }
    this.pendingSends.clear()
    this.handler = null
    this.statusHandler = null
    if (!proc) return
    try { proc.stdin?.write(encodeMessage({ type: 'shutdown' })); proc.kill() } catch {}
  }
  isConnected(): boolean { return this.connected }
  async requestPairingCode(phoneNumber: string): Promise<void> { this.send({ type: 'request_pairing_code', phoneNumber }) }
  async sendText(channelId: string, text: string): Promise<SentMessage> { return this.waitForSend({ type: 'send_text', requestId: crypto.randomUUID(), channelId, text }, channelId) }
  async sendFile(channelId: string, file: Buffer, filename: string, caption?: string): Promise<SentMessage> { return this.waitForSend({ type: 'send_media', requestId: crypto.randomUUID(), channelId, data: file.toString('base64'), filename, ...(caption ? { caption } : {}) }, channelId) }
  private startWorker(): void {
    const proc = spawn(this.options.nodeBin ?? process.execPath, [this.options.workerEntry], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: this.options.electronRunAsNode ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env })
    this.proc = proc
    const decoder = new StringDecoder('utf8')
    proc.stdout?.on('data', chunk => this.consume(decoder.write(chunk)))
    proc.once('error', () => this.handleWorkerExit(proc, 'WhatsApp worker failed to start'))
    proc.once('exit', () => this.handleWorkerExit(proc, 'WhatsApp worker exited'))
    this.send({ type: 'start', authDir: this.options.authDir, pairingMode: this.pairingMode, allowedGroupJids: this.allowedGroupJids })
  }
  private handleWorkerExit(proc: ChildProcess, message: string): void {
    if (this.proc !== proc) return
    this.proc = null
    this.connected = false
    for (const pending of this.pendingSends.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)) }
    this.pendingSends.clear()
    if (this.disposing) return
    if (this.restartAttempts >= 5) { this.statusHandler?.({ connected: false, state: 'error', lastError: 'WhatsApp worker stopped after repeated failures' }); return }
    const delay = Math.min(1_000 * 2 ** this.restartAttempts++, 16_000)
    this.statusHandler?.({ connected: false, state: 'connecting', lastError: message })
    this.restartTimer = setTimeout(() => { this.restartTimer = null; if (!this.disposing && !this.proc) this.startWorker() }, delay)
  }
  private send(command: WorkerCommand): void { if (!this.proc?.stdin?.writable) throw new Error('WhatsApp worker is not running'); this.proc.stdin.write(encodeMessage(command)) }
  private waitForSend(command: Extract<WorkerCommand, { type: 'send_text' | 'send_media' }>, channelId: string): Promise<SentMessage> { return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pendingSends.delete(command.requestId); reject(new Error('WhatsApp send timed out')) }, 20_000); this.pendingSends.set(command.requestId, { channelId, resolve, reject, timer }); try { this.send(command) } catch (error) { clearTimeout(timer); this.pendingSends.delete(command.requestId); reject(error instanceof Error ? error : new Error('WhatsApp worker is not running')) } }) }
  private consume(chunk: string): void { const parsed = parseFrames<WorkerEvent>(this.buffer + chunk); this.buffer = parsed.rest; for (const event of parsed.messages) { if (event.type === 'send_result') { const pending = this.pendingSends.get(event.requestId); if (pending) { clearTimeout(pending.timer); this.pendingSends.delete(event.requestId); event.error ? pending.reject(new Error(event.error)) : pending.resolve({ platform: 'whatsapp', channelId: pending.channelId, messageId: event.messageId ?? '' }) } continue } if (event.type === 'qr') { this.statusHandler?.({ state: 'connecting', qrCode: event.value }); this.uiEventHandler?.({ type: 'qr', qr: event.value }) } if (event.type === 'pairing_code') this.uiEventHandler?.({ type: 'pairing_code', code: event.code }); if (event.type === 'connected') { this.connected = true; this.statusHandler?.({ connected: true, state: 'connected', identity: event.jid, qrCode: undefined }); this.uiEventHandler?.({ type: 'connected', jid: event.jid }) } if (event.type === 'disconnected') { this.connected = false; this.statusHandler?.({ connected: false, state: 'disconnected', lastError: event.reason, qrCode: undefined }); this.uiEventHandler?.({ type: 'disconnected', loggedOut: event.reason === 'logged_out', ...(event.reason ? { reason: event.reason } : {}) }) } if (event.type === 'unavailable') { this.connected = false; this.statusHandler?.({ connected: false, state: 'error', lastError: event.message }); this.uiEventHandler?.({ type: 'unavailable', reason: event.reason, message: event.message }) } if (event.type === 'error') this.uiEventHandler?.({ type: 'error', message: event.message }); if (event.type === 'incoming') void this.handler?.({ platform: 'whatsapp', channelId: event.channelId, chatType: event.chatType, messageId: event.messageId, senderId: event.senderId, senderName: event.senderName, text: event.text, ...(event.attachments ? { attachments: event.attachments } : {}), timestamp: event.timestamp, raw: undefined }) } }
}

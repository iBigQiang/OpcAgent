import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessagingGatewayRegistry } from '../registry'
import { TelegramConnectionError } from '../adapters/telegram'
import type { IncomingMessage, PlatformAdapter } from '../types'
import type { MessagingSession } from '../session-manager'

function adapter(platform: 'telegram' | 'whatsapp' | 'lark' = 'telegram'): PlatformAdapter & { receive(message: IncomingMessage): Promise<void>; initialized: number } {
  let handler: (message: IncomingMessage) => Promise<void> = async () => {}
  let connected = false
  return { platform, initialized: 0, async initialize() { this.initialized++; connected = true }, async destroy() { connected = false }, isConnected: () => connected, onMessage(next) { handler = next }, async sendText() {}, receive: message => handler(message) }
}

function interactiveTelegramAdapter() {
  let handler: (message: IncomingMessage) => Promise<void> = async () => {}
  let buttonHandler: (press: import('../types').ButtonPress) => Promise<void> = async () => {}
  let connected = false
  const buttons: Array<{ channelId: string; text: string; rows: Array<{ id: string; label: string; data?: string }> }> = []
  const cleared: Array<{ channelId: string; messageId: string }> = []
  return {
    platform: 'telegram' as const,
    async initialize() { connected = true }, async destroy() { connected = false }, isConnected: () => connected,
    onMessage(next: (message: IncomingMessage) => Promise<void>) { handler = next },
    onButtonPress(next: (press: import('../types').ButtonPress) => Promise<void>) { buttonHandler = next },
    async sendText() {},
    async sendButtons(channelId: string, text: string, rows: Array<{ id: string; label: string; data?: string }>) {
      buttons.push({ channelId, text, rows })
      return { platform: 'telegram' as const, channelId, messageId: String(buttons.length) }
    },
    async clearButtons(channelId: string, messageId: string) { cleared.push({ channelId, messageId }) },
    receive: (message: IncomingMessage) => handler(message),
    press: (press: import('../types').ButtonPress) => buttonHandler(press),
    buttons,
    cleared,
  }
}

function setup() {
  const events: Array<{ channel: string; workspaceId: string; payload: unknown }> = []
  const adapters = new Map<string, ReturnType<typeof adapter>>()
  const registry = new MessagingGatewayRegistry({
    getMessagingDir: (workspaceId: string) => join(mkdtempSync(join(tmpdir(), 'messaging-registry-')), workspaceId),
    sendToSession: async () => {},
    createAdapter: (platform, workspaceId) => {
      const key = `${workspaceId}:${platform}`
      const value = adapters.get(key) ?? adapter(platform)
      adapters.set(key, value)
      return value
    },
    publish: (channel, workspaceId, payload) => events.push({ channel, workspaceId, payload }),
  })
  return { registry, adapters, events }
}

test('session events send only completed text to the matching connected binding', async () => {
  const { registry, adapters } = setup()
  const sent: Array<{ channelId: string; text: string }> = []
  const whatsapp = adapters.get('one:whatsapp') ?? adapter('whatsapp')
  whatsapp.sendText = async (channelId, text) => { sent.push({ channelId, text }) }
  adapters.set('one:whatsapp', whatsapp)
  registry.bind('one', { sessionId: 'session-1', platform: 'whatsapp', channelId: 'chat-1' })
  await registry.connect('one', 'whatsapp')

  registry.onSessionEvent('session:event', { to: 'workspace', workspaceId: 'one' }, { type: 'text_delta', sessionId: 'session-1', text: 'partial' })
  registry.onSessionEvent('session:event', { to: 'workspace', workspaceId: 'one' }, { type: 'text_complete', sessionId: 'other', text: 'wrong session' })
  registry.onSessionEvent('session:event', { to: 'workspace', workspaceId: 'two' }, { type: 'text_complete', sessionId: 'session-1', text: 'wrong workspace' })
  registry.onSessionEvent('session:event', { to: 'workspace', workspaceId: 'one' }, { type: 'text_complete', sessionId: 'session-1', text: 'final answer' })
  registry.onSessionEvent('session:event', { to: 'workspace', workspaceId: 'one' }, { type: 'complete', sessionId: 'session-1' })
  await Promise.resolve()

  expect(sent).toEqual([{ channelId: 'chat-1', text: 'final answer' }])
})

function incoming(senderId: string, text = 'hello'): IncomingMessage { return { platform: 'whatsapp', channelId: 'chat', messageId: `${senderId}-${text}`, senderId, text, timestamp: 1 } }

test('pending owner requests are workspace isolated, publish changes, and approval persists owners', async () => {
  const { registry, adapters, events } = setup()
  registry.bind('one', { sessionId: 's1', platform: 'whatsapp', channelId: 'chat' })
  registry.bind('two', { sessionId: 's2', platform: 'whatsapp', channelId: 'chat' })
  registry.setPlatformAccessMode('one', 'whatsapp', 'owner-only')
  await registry.connect('one', 'whatsapp')
  await adapters.get('one:whatsapp')!.receive(incoming('stranger'))
  expect(registry.getPendingSenders('one', 'whatsapp')).toHaveLength(1)
  expect(registry.getPendingSenders('two', 'telegram')).toEqual([])
  expect(events.some(event => event.channel === 'messaging:pendingChanged' && event.workspaceId === 'one')).toBe(true)
  expect(registry.allowPendingSender('one', 'whatsapp', 'stranger', {
    reason: 'not-owner',
    bindingId: registry.getPendingSenders('one', 'whatsapp')[0]?.bindingId,
  })).toMatchObject({ owners: [{ userId: 'stranger' }] })
  expect(registry.getPlatformOwners('one', 'whatsapp')).toMatchObject([{ userId: 'stranger' }])
  expect(registry.getPendingSenders('one', 'telegram')).toEqual([])
  expect(registry.getPlatformOwners('two', 'whatsapp')).toEqual([])
  expect(events.some(event => event.channel === 'messaging:bindingChanged' && event.workspaceId === 'one')).toBe(true)
})

test('allow-list pending approval updates only its binding and dismiss removes all matching rows', async () => {
  const { registry, adapters } = setup()
  const binding = registry.bind('one', { sessionId: 's1', platform: 'whatsapp', channelId: 'chat', config: { accessMode: 'allow-list', allowedSenderIds: ['owner'] } })
  await registry.connect('one', 'whatsapp')
  const fake = adapters.get('one:whatsapp')!
  await fake.receive(incoming('guest'))
  expect(registry.getPendingSenders('one')[0]).toMatchObject({ senderId: 'guest', reason: 'not-on-binding-allowlist', bindingId: binding.id })
  registry.allowPendingSender('one', 'whatsapp', 'guest', { reason: 'not-on-binding-allowlist', bindingId: binding.id })
  expect(registry.getBindings('one').find(value => value.id === binding.id)?.config.allowedSenderIds).toEqual(['owner', 'guest'])
  expect(registry.getPlatformOwners('one', 'whatsapp')).toEqual([])
  await fake.receive(incoming('another'))
  expect(registry.dismissPendingSender('one', 'whatsapp', 'another', { reason: 'not-on-binding-allowlist', bindingId: binding.id })).toBe(true)
  expect(registry.getPendingSenders('one')).toEqual([])
})

test('pending queue is bounded and connected adapters are not initialized twice', async () => {
  const { registry, adapters } = setup()
  registry.bind('one', { sessionId: 's1', platform: 'whatsapp', channelId: 'chat' })
  registry.setPlatformAccessMode('one', 'whatsapp', 'owner-only')
  await registry.connect('one', 'whatsapp')
  await registry.connect('one', 'whatsapp')
  const fake = adapters.get('one:whatsapp')!
  expect(fake.initialized).toBe(1)
  for (let index = 0; index < 101; index++) await fake.receive(incoming(`user-${index}`))
  expect(registry.getPendingSenders('one')).toHaveLength(50)
  expect(registry.getPendingSenders('one').some(value => value.senderId === 'user-0')).toBe(false)
})

test('an authorised unbound Telegram message can create a session and delivers only its in-memory original after confirmation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'messaging-unbound-telegram-'))
  const telegram = interactiveTelegramAdapter()
  const delivered: Array<{ sessionId: string; text: string }> = []
  const sessions: MessagingSession[] = []
  const registry = new MessagingGatewayRegistry({
    getMessagingDir: () => root,
    adapters: { telegram },
    credentialManager: { async get() { return { value: 'test-only' } }, async set() {}, async delete() { return true } },
    sessionManager: {
      getSessions: (workspaceId?: string) => sessions.filter(session => session.workspaceId === workspaceId),
      getSession: async (id: string) => sessions.find(session => session.id === id) ?? null,
      createSession: async (workspaceId: string) => { const session: MessagingSession = { id: 'created-session', workspaceId, name: 'New chat', lastMessageAt: 1 }; sessions.push(session); return session },
      sendMessage: async (sessionId: string, text: string) => { delivered.push({ sessionId, text }) },
    } as never,
  })
  registry.setPlatformAccessMode('one', 'telegram', 'owner-only')
  registry.setPlatformOwners('one', 'telegram', [{ userId: 'owner', addedAt: 1 }])
  await registry.connect('one', 'telegram')

  const secretCanary = 'original-message-must-not-persist'
  await telegram.receive({ platform: 'telegram', chatType: 'private', channelId: 'owner-chat', messageId: 'm1', senderId: 'owner', text: secretCanary, timestamp: 1 })
  await telegram.receive({ platform: 'telegram', chatType: 'private', channelId: 'guest-chat', messageId: 'm2', senderId: 'guest', text: 'guest message', timestamp: 1 })

  expect(telegram.buttons).toHaveLength(1)
  expect(telegram.buttons[0]?.rows.map(row => row.id)).toEqual(['unbound:new', 'unbound:choose'])
  expect(telegram.buttons[0]?.text).toContain('使用默认模型新建会话')
  expect(JSON.stringify({ config: registry.getConfig('one'), bindings: registry.getBindings('one') })).not.toContain(secretCanary)

  await telegram.press({ platform: 'telegram', channelId: 'owner-chat', messageId: 'prompt-1', senderId: 'owner', buttonId: telegram.buttons[0]!.rows[0]!.data! })

  expect(registry.getBindings('one')).toMatchObject([{ sessionId: 'created-session', platform: 'telegram', channelId: 'owner-chat' }])
  expect(delivered).toEqual([{ sessionId: 'created-session', text: secretCanary }])
})

test('an authorised unbound Telegram message can select an existing session and newer input replaces the pending message', async () => {
  const root = mkdtempSync(join(tmpdir(), 'messaging-unbound-telegram-existing-'))
  const telegram = interactiveTelegramAdapter()
  const delivered: Array<{ sessionId: string; text: string }> = []
  const sessions: MessagingSession[] = [{ id: 'existing-session', workspaceId: 'one', name: 'Existing chat', lastMessageAt: 2 }]
  const registry = new MessagingGatewayRegistry({
    getMessagingDir: () => root,
    adapters: { telegram },
    credentialManager: { async get() { return { value: 'test-only' } }, async set() {}, async delete() { return true } },
    sessionManager: {
      getSessions: (workspaceId?: string) => sessions.filter(session => session.workspaceId === workspaceId),
      getSession: async (id: string) => sessions.find(session => session.id === id) ?? null,
      createSession: async () => { throw new Error('new session must not be selected') },
      sendMessage: async (sessionId: string, text: string) => { delivered.push({ sessionId, text }) },
    } as never,
  })
  registry.setPlatformAccessMode('one', 'telegram', 'owner-only')
  registry.setPlatformOwners('one', 'telegram', [{ userId: 'owner', addedAt: 1 }])
  await registry.connect('one', 'telegram')

  await telegram.receive({ platform: 'telegram', chatType: 'private', channelId: 'owner-chat', messageId: 'm1', senderId: 'owner', text: 'discard this earlier message', timestamp: 1 })
  await telegram.receive({ platform: 'telegram', chatType: 'private', channelId: 'owner-chat', messageId: 'm2', senderId: 'owner', text: 'deliver this newer message', timestamp: 2 })
  await telegram.receive({ platform: 'telegram', chatType: 'private', channelId: 'guest-chat', messageId: 'm3', senderId: 'guest', text: 'guest must not be prompted', timestamp: 3 })
  expect(telegram.buttons).toHaveLength(2)

  const staleChoose = telegram.buttons[0]!.rows[1]!.data!
  const activeChoose = telegram.buttons[1]!.rows[1]!.data!
  await telegram.press({ platform: 'telegram', channelId: 'owner-chat', messageId: 'prompt-old', senderId: 'owner', buttonId: staleChoose })
  expect(telegram.buttons).toHaveLength(2)
  await telegram.press({ platform: 'telegram', channelId: 'owner-chat', messageId: 'prompt-2', senderId: 'owner', buttonId: activeChoose })
  const option = telegram.buttons.at(-1)!.rows[0]!.data!
  expect(option).toMatch(/^unbound:session:[a-f0-9]{16}:[a-f0-9]{16}$/)
  expect(option).not.toContain('existing-session')
  await telegram.press({ platform: 'telegram', channelId: 'other-chat', messageId: 'forged', senderId: 'owner', buttonId: option })
  await telegram.press({ platform: 'telegram', channelId: 'owner-chat', messageId: 'choice-1', senderId: 'guest', buttonId: option })
  expect(delivered).toEqual([])
  await telegram.press({ platform: 'telegram', channelId: 'owner-chat', messageId: 'choice-1', senderId: 'owner', buttonId: option })
  await telegram.press({ platform: 'telegram', channelId: 'owner-chat', messageId: 'choice-2', senderId: 'owner', buttonId: option })

  expect(registry.getBindings('one')).toMatchObject([{ sessionId: 'existing-session', channelId: 'owner-chat' }])
  expect(delivered).toEqual([{ sessionId: 'existing-session', text: 'deliver this newer message' }])
  expect(JSON.stringify({ config: registry.getConfig('one'), bindings: registry.getBindings('one') })).not.toContain('deliver this newer message')
  expect(telegram.cleared).toHaveLength(3)
})

test('unbound Telegram prompt tokens expire without binding or delivering the original message', async () => {
  const root = mkdtempSync(join(tmpdir(), 'messaging-unbound-telegram-expiry-'))
  const telegram = interactiveTelegramAdapter()
  const delivered: string[] = []
  let now = 1
  const registry = new MessagingGatewayRegistry({
    getMessagingDir: () => root,
    adapters: { telegram },
    credentialManager: { async get() { return { value: 'test-only' } }, async set() {}, async delete() { return true } },
    now: () => now,
    sessionManager: {
      getSessions: () => [], getSession: async () => null,
      createSession: async () => ({ id: 'late-session', workspaceId: 'one', lastMessageAt: 1 }),
      sendMessage: async (_sessionId: string, text: string) => { delivered.push(text) },
    } as never,
  })
  registry.setPlatformAccessMode('one', 'telegram', 'owner-only')
  registry.setPlatformOwners('one', 'telegram', [{ userId: 'owner', addedAt: 1 }])
  await registry.connect('one', 'telegram')
  await telegram.receive({ platform: 'telegram', chatType: 'private', channelId: 'owner-chat', messageId: 'm1', senderId: 'owner', text: 'expired original', timestamp: 1 })
  const buttonId = telegram.buttons[0]!.rows[0]!.data!
  now += 10 * 60_000 + 1
  await telegram.press({ platform: 'telegram', channelId: 'owner-chat', messageId: 'expired-prompt', senderId: 'owner', buttonId })
  expect(registry.getBindings('one')).toEqual([])
  expect(delivered).toEqual([])
  expect(telegram.cleared).toEqual([{ channelId: 'owner-chat', messageId: '1' }])
})

test('WhatsApp enablement persists and reconnects during workspace initialization', async () => {
  const root = mkdtempSync(join(tmpdir(), 'messaging-restart-'))
  const firstAdapter = adapter('whatsapp')
  const first = new MessagingGatewayRegistry({ getMessagingDir: () => root, sendToSession: async () => {}, adapters: { whatsapp: firstAdapter } })
  await first.startWhatsAppConnect('one')
  expect(first.getConfig('one')).toMatchObject({ enabled: true, platforms: { whatsapp: { enabled: true } } })
  await first.dispose()

  const secondAdapter = adapter('whatsapp')
  const second = new MessagingGatewayRegistry({ getMessagingDir: () => root, sendToSession: async () => {}, adapters: { whatsapp: secondAdapter } })
  await second.initializeWorkspace('one')
  expect(secondAdapter.initialized).toBe(1)
  await second.dispose()
})

test('legacy platform credentials are enabled and reconnected without exposing their value', async () => {
  const root = mkdtempSync(join(tmpdir(), 'messaging-legacy-'))
  const telegram = adapter('telegram')
  const reads: string[] = []
  const credentials = {
    async get(id: { sourceId: string }) { reads.push(id.sourceId); return id.sourceId === 'messaging-telegram' ? { value: 'test-only-secret' } : null },
    async set() {},
    async delete() { return true },
  }
  const registry = new MessagingGatewayRegistry({ getMessagingDir: () => root, sendToSession: async () => {}, credentialManager: credentials, adapters: { telegram } })
  await registry.initializeWorkspace('one')
  expect(reads).toEqual(['messaging-telegram', 'messaging-lark', 'messaging-telegram'])
  expect(registry.getConfig('one')).toMatchObject({ enabled: true, platforms: { telegram: { enabled: true } } })
  expect(telegram.initialized).toBe(1)
  expect(JSON.stringify(registry.getConfig('one'))).not.toContain('test-only-secret')
  await registry.dispose()
})

test('saving a Telegram token reports a safe connection failure while retaining configuration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'messaging-telegram-save-'))
  const secret = 'secret-canary-telegram-token'
  const telegram = adapter('telegram')
  telegram.initialize = async () => {
    throw new TelegramConnectionError('Telegram connection failed during bot verification.', 'verify_bot', 'ETIMEDOUT')
  }
  const credentials = {
    value: null as string | null,
    async get() { return this.value ? { value: this.value } : null },
    async set(_id: unknown, credential: { value: string }) { this.value = credential.value },
    async delete() { this.value = null; return true },
  }
  const registry = new MessagingGatewayRegistry({
    getMessagingDir: () => root,
    sendToSession: async () => {},
    credentialManager: credentials,
    adapters: { telegram },
  })

  await expect(registry.saveTelegramToken('one', secret))
    .rejects.toThrow('Telegram connection failed during bot verification.')
  expect(registry.getConfig('one')).toMatchObject({ enabled: true, platforms: { telegram: { enabled: true } } })
  expect(registry.getRuntime('one').find(value => value.platform === 'telegram')).toMatchObject({
    configured: true,
    connected: false,
    state: 'error',
    lastError: 'Telegram connection failed during bot verification.',
  })
  expect(JSON.stringify({ config: registry.getConfig('one'), runtime: registry.getRuntime('one') })).not.toContain(secret)
})

test('a supplied adapter cannot cross workspace boundaries', async () => {
  const shared = adapter('whatsapp')
  const registry = new MessagingGatewayRegistry({
    getMessagingDir: workspaceId => join(mkdtempSync(join(tmpdir(), 'messaging-registry-')), workspaceId),
    sendToSession: async () => {},
    adapters: { whatsapp: shared },
  })
  await registry.connect('one', 'whatsapp')
  await registry.connect('two', 'whatsapp')
  expect(registry.getRuntime('one').find(value => value.platform === 'whatsapp')?.state).toBe('connected')
  expect(registry.getRuntime('two').find(value => value.platform === 'whatsapp')?.state).toBe('error')
  expect(shared.initialized).toBe(1)
})

test('pairing-code generation rejects a session from another workspace', () => {
  const registry = new MessagingGatewayRegistry({
    getMessagingDir: workspaceId => join(mkdtempSync(join(tmpdir(), 'messaging-registry-')), workspaceId),
    sessionManager: {
      getSessions: (workspaceId: string) => workspaceId === 'one'
        ? [{ id: 'session-one', workspaceId: 'one' }]
        : [{ id: 'session-two', workspaceId: 'two' }],
    } as never,
  })

  expect(() => registry.generatePairingCode('one', 'session-two', 'telegram'))
    .toThrow('Session does not belong to this workspace')
})

test('workspace owner pairing adds only the Telegram owner and no session binding', async () => {
  const root = mkdtempSync(join(tmpdir(), 'messaging-owner-pair-'))
  const telegram = adapter('telegram')
  const events: string[] = []
  const registry = new MessagingGatewayRegistry({
    getMessagingDir: () => root,
    credentialManager: { async get() { return { value: 'test-only' } }, async set() {}, async delete() { return true } },
    adapters: { telegram },
    publish: channel => events.push(channel),
    sessionManager: { getSessions: () => { throw new Error('owner pairing must not inspect sessions') } } as never,
  })
  const issued = registry.generateOwnerPairingCode('one', 'telegram')
  expect(issued.code).toMatch(/^\d{6}$/)
  expect(issued.expiresAt).toBeGreaterThan(Date.now())
  await registry.connect('one', 'telegram')
  await telegram.receive({ platform: 'telegram', chatType: 'private', channelId: 'private', messageId: '1', senderId: 'invited-owner', text: `/pair ${issued.code}`, timestamp: 1 })

  expect(registry.getPlatformOwners('one', 'telegram')).toMatchObject([{ userId: 'invited-owner' }])
  expect(registry.getBindings('one')).toEqual([])
  expect(events).toContain('messaging:bindingChanged')
})

test('approved owners survive a registry restart without exposing credentials', () => {
  const secretCanary = 'secret-canary-9b2e6c'
  const root = mkdtempSync(join(tmpdir(), 'messaging-registry-persist-'))
  const makeRegistry = () => new MessagingGatewayRegistry({
    getMessagingDir: workspaceId => join(root, workspaceId),
    sendToSession: async () => {},
  })
  const first = makeRegistry()
  first.setPlatformOwners('one', 'telegram', [{ userId: 'owner-1', addedAt: 1 }])
  const second = makeRegistry()
  expect(second.getPlatformOwners('one', 'telegram')).toMatchObject([{ userId: 'owner-1' }])
  expect(JSON.stringify({ config: second.getConfig('one'), pending: second.getPendingSenders('one') })).not.toContain(secretCanary)
})

test('pending sender metadata never retains message text', async () => {
  const secretCanary = 'secret-canary-message-4d71c8'
  const { registry, adapters, events } = setup()
  registry.bind('one', { sessionId: 's1', platform: 'whatsapp', channelId: 'chat' })
  registry.setPlatformAccessMode('one', 'whatsapp', 'owner-only')
  await registry.connect('one', 'whatsapp')
  await adapters.get('one:whatsapp')!.receive(incoming('stranger', secretCanary))

  expect(JSON.stringify({
    config: registry.getConfig('one'),
    pending: registry.getPendingSenders('one'),
    events,
  })).not.toContain(secretCanary)
})

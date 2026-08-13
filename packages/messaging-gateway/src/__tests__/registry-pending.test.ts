import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessagingGatewayRegistry } from '../registry'
import type { IncomingMessage, PlatformAdapter } from '../types'

function adapter(platform: 'telegram' | 'whatsapp' | 'lark' = 'telegram'): PlatformAdapter & { receive(message: IncomingMessage): Promise<void>; initialized: number } {
  let handler: (message: IncomingMessage) => Promise<void> = async () => {}
  let connected = false
  return { platform, initialized: 0, async initialize() { this.initialized++; connected = true }, async destroy() { connected = false }, isConnected: () => connected, onMessage(next) { handler = next }, async sendText() {}, receive: message => handler(message) }
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

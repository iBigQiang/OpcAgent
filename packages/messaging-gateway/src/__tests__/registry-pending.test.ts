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
    getMessagingDir: workspaceId => join(mkdtempSync(join(tmpdir(), 'messaging-registry-')), workspaceId),
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
  expect(registry.allowPendingSender('one', 'whatsapp', 'stranger')).toEqual(['stranger'])
  expect(registry.getPlatformOwners('one', 'whatsapp')).toEqual(['stranger'])
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
  registry.allowPendingSender('one', 'whatsapp', 'guest')
  expect(registry.getBindings('one').find(value => value.id === binding.id)?.config.allowedSenderIds).toEqual(['owner', 'guest'])
  expect(registry.getPlatformOwners('one', 'whatsapp')).toEqual([])
  await fake.receive(incoming('another'))
  expect(registry.dismissPendingSender('one', 'whatsapp', 'another')).toBe(true)
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
  expect(registry.getPendingSenders('one')).toHaveLength(100)
  expect(registry.getPendingSenders('one').some(value => value.senderId === 'user-0')).toBe(false)
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

test('approved owners survive a registry restart without exposing credentials', () => {
  const secretCanary = 'secret-canary-9b2e6c'
  const root = mkdtempSync(join(tmpdir(), 'messaging-registry-persist-'))
  const makeRegistry = () => new MessagingGatewayRegistry({
    getMessagingDir: workspaceId => join(root, workspaceId),
    sendToSession: async () => {},
  })
  const first = makeRegistry()
  first.setPlatformOwners('one', 'telegram', ['owner-1'])
  const second = makeRegistry()
  expect(second.getPlatformOwners('one', 'telegram')).toEqual(['owner-1'])
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

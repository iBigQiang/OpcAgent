import { expect, test } from 'bun:test'
import { PairingCodeManager } from '../pairing'
import { Commands, consumePairCommand } from '../commands'
import { BindingStore } from '../binding-store'
import { MessageRouter } from '../router'
import { TopicRegistry } from '../topic-registry'
import type { IncomingMessage, PlatformAdapter } from '../types'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('pair codes are workspace-scoped single-use and topics are workspace-isolated', () => {
  const pairing = new PairingCodeManager(() => 10)
  const issued = pairing.create('one', 'session-1', 'telegram')
  expect(consumePairCommand(`/pair ${issued.code}`, 'two', 'telegram', pairing)).toBeNull()
  expect(consumePairCommand(`/pair ${issued.code}`, 'one', 'telegram', pairing)).toEqual({ sessionId: 'session-1' })
  expect(consumePairCommand(`/pair ${issued.code}`, 'one', 'telegram', pairing)).toBeNull()
  const topics = new TopicRegistry(); topics.put({ workspaceId: 'one', platform: 'telegram', channelId: 'chat', threadId: 4, name: 'daily' })
  expect(topics.get('two', 'chat', 'daily')).toBeUndefined()
  expect(topics.get('one', 'chat', 'daily')?.threadId).toBe(4)
})

test('pair codes are six digits, include supergroup kind, and consume limits are sender-scoped', () => {
  const pairing = new PairingCodeManager(() => 100)
  const entry = pairing.createSupergroup('one', 'telegram')
  expect(entry.code).toMatch(/^\d{6}$/)
  expect(entry.kind).toBe('workspace-supergroup')
  for (let index = 0; index < 5; index++) expect(pairing.canConsume('one', 'telegram', 'sender')).toBe(true)
  expect(pairing.canConsume('one', 'telegram', 'sender')).toBe(true)
  for (let index = 0; index < 5; index++) pairing.consume('000000', 'one', 'telegram', 'sender')
  expect(pairing.consume(entry.code, 'one', 'telegram', 'sender')).toBeNull()
  expect(pairing.consume(entry.code, 'one', 'telegram', 'other')?.kind).toBe('workspace-supergroup')
})

test('Router gives /pair and /new to Commands before bound message routing', async () => {
  const pairing = new PairingCodeManager()
  const store = new BindingStore(mkdtempSync(join(tmpdir(), 'opcagent-commands-')))
  const sent: string[] = []
  const adapter: PlatformAdapter = {
    platform: 'telegram',
    async initialize() {}, async destroy() {}, isConnected: () => true, onMessage() {},
    async sendText(_channelId, text) { sent.push(text) },
  }
  const config = { version: 1 as const, enabled: true, platforms: {} }
  const commands = new Commands({
    workspaceId: 'one', bindingStore: store, pairing, getConfig: () => config,
    sessionManager: { createSession: async () => ({ id: 'new-session', name: 'New chat' }) } as never,
  })
  const router = new MessageRouter({ bindingStore: store, commands, getConfig: () => config, sendToSession: async () => {} })
  const code = pairing.create('one', 'paired-session', 'telegram')
  const incoming = (text: string): IncomingMessage => ({ platform: 'telegram', chatType: 'private', channelId: 'chat', messageId: text, senderId: 'owner', text, timestamp: 1 })
  expect(await router.route(incoming(`/pair ${code.code}`), adapter)).toBe(true)
  expect(store.findByChannel('telegram', 'chat')?.sessionId).toBe('paired-session')
  expect(await router.route(incoming('/new second'), adapter)).toBe(true)
  expect(store.findByChannel('telegram', 'chat')?.sessionId).toBe('new-session')
  expect(sent).toHaveLength(2)
})

test('supergroup codes require an existing owner in their Telegram supergroup', async () => {
  const pairing = new PairingCodeManager()
  const store = new BindingStore(mkdtempSync(join(tmpdir(), 'opcagent-supergroup-')))
  let paired = ''
  const commands = new Commands({ workspaceId: 'one', bindingStore: store, pairing, getConfig: () => ({ version: 1, enabled: true, platforms: {}, access: { telegram: { mode: 'owner-only', ownerIds: ['owner'] } } }), onSupergroupPaired: message => { paired = message.channelId } })
  const adapter: PlatformAdapter = { platform: 'telegram', async initialize() {}, async destroy() {}, isConnected: () => true, onMessage() {}, async sendText() {} }
  const code = pairing.createSupergroup('one', 'telegram')
  await commands.handle(adapter, { platform: 'telegram', chatType: 'supergroup', channelId: 'group', messageId: '1', senderId: 'owner', text: `/pair ${code.code}`, timestamp: 1 })
  expect(paired).toBe('group')
})

test('sensitive commands require an owner and support bind status stop and unbind', async () => {
  const pairing = new PairingCodeManager()
  const store = new BindingStore(mkdtempSync(join(tmpdir(), 'opcagent-command-access-')))
  const sent: string[] = []
  const stopped: string[] = []
  const sessions = [
    { id: 'session-one', workspaceId: 'one', name: 'First', lastMessageAt: 2, isArchived: false },
    { id: 'session-two', workspaceId: 'one', name: 'Second', lastMessageAt: 1, isArchived: false },
  ]
  const commands = new Commands({
    workspaceId: 'one', bindingStore: store, pairing,
    getConfig: () => ({ version: 1, enabled: true, platforms: {}, access: { telegram: { mode: 'owner-only', ownerIds: ['owner'] } } }),
    sessionManager: {
      getSessions: () => sessions,
      getSession: async (id: string) => sessions.find(session => session.id === id) ?? null,
      cancelProcessing: async (id: string) => { stopped.push(id) },
    } as never,
  })
  const adapter: PlatformAdapter = { platform: 'telegram', async initialize() {}, async destroy() {}, isConnected: () => true, onMessage() {}, async sendText(_channel, text) { sent.push(text) } }
  const message = (senderId: string, text: string): IncomingMessage => ({ platform: 'telegram', chatType: 'private', channelId: 'chat', messageId: text, senderId, text, timestamp: 1 })

  await commands.handle(adapter, message('stranger', '/bind'))
  expect(sent.at(-1)).toContain('private')
  await commands.handle(adapter, message('owner', '/bind'))
  expect(sent.at(-1)).toContain('Recent sessions')
  await commands.handle(adapter, message('owner', '/bind 1'))
  expect(store.findByChannel('telegram', 'chat')?.sessionId).toBe('session-one')
  await commands.handle(adapter, message('owner', '/status'))
  expect(sent.at(-1)).toContain('First')
  await commands.handle(adapter, message('owner', '/stop'))
  expect(stopped).toEqual(['session-one'])
  await commands.handle(adapter, message('owner', '/unbind'))
  expect(store.findByChannel('telegram', 'chat')).toBeUndefined()
})

test('owner-only pairing seeds the first owner and rejects later strangers before consuming', async () => {
  const pairing = new PairingCodeManager()
  const store = new BindingStore(mkdtempSync(join(tmpdir(), 'opcagent-pair-owner-')))
  let owners: string[] = []
  const sent: string[] = []
  const commands = new Commands({
    workspaceId: 'one', bindingStore: store, pairing,
    getConfig: () => ({ version: 1, enabled: true, platforms: {}, access: { telegram: { mode: 'owner-only', ownerIds: owners } } }),
    seedOwnerOnFirstPair: (_platform, message) => { if (!owners.length) owners = [message.senderId] },
  })
  const adapter: PlatformAdapter = { platform: 'telegram', async initialize() {}, async destroy() {}, isConnected: () => true, onMessage() {}, async sendText(_channel, text) { sent.push(text) } }
  const first = pairing.create('one', 'session-one', 'telegram')
  await commands.handle(adapter, { platform: 'telegram', chatType: 'private', channelId: 'chat', messageId: '1', senderId: 'owner', text: `/pair ${first.code}`, timestamp: 1 })
  expect(owners).toEqual(['owner'])
  const second = pairing.create('one', 'session-two', 'telegram')
  await commands.handle(adapter, { platform: 'telegram', chatType: 'private', channelId: 'other-chat', messageId: '2', senderId: 'stranger', text: `/pair ${second.code}`, timestamp: 1 })
  expect(sent.at(-1)).toContain('existing owner')
  expect(pairing.consume(second.code, 'one', 'telegram', 'owner')?.sessionId).toBe('session-two')
})

test('workspace owner codes are private Telegram-only, rate limited, and do not create bindings', async () => {
  const pairing = new PairingCodeManager()
  const store = new BindingStore(mkdtempSync(join(tmpdir(), 'opcagent-owner-pair-')))
  let owners = ['existing-owner']
  const sent: string[] = []
  const commands = new Commands({
    workspaceId: 'one',
    bindingStore: store,
    pairing,
    getConfig: () => ({ version: 1, enabled: true, platforms: {}, access: { telegram: { mode: 'owner-only', ownerIds: owners } } }),
    onWorkspaceOwnerPaired: message => { if (!owners.includes(message.senderId)) owners = [...owners, message.senderId] },
  })
  const telegram: PlatformAdapter = { platform: 'telegram', async initialize() {}, async destroy() {}, isConnected: () => true, onMessage() {}, async sendText(_channel, text) { sent.push(text) } }
  const whatsapp: PlatformAdapter = { platform: 'whatsapp', async initialize() {}, async destroy() {}, isConnected: () => true, onMessage() {}, async sendText(_channel, text) { sent.push(text) } }
  const privateMessage = (senderId: string, text: string): IncomingMessage => ({ platform: 'telegram', chatType: 'private', channelId: `private-${senderId}`, messageId: text, senderId, text, timestamp: 1 })

  const rateLimited = pairing.createOwner('one', 'telegram')
  for (let index = 0; index < 5; index++) await commands.handle(telegram, privateMessage('guesser', `/pair 00000${index}`))
  await commands.handle(telegram, privateMessage('guesser', `/pair ${rateLimited.code}`))
  expect(owners).toEqual(['existing-owner'])
  await commands.handle(telegram, privateMessage('invited', `/pair ${rateLimited.code}`))
  expect(owners).toEqual(['existing-owner', 'invited'])
  expect(store.getAll()).toEqual([])

  const restricted = pairing.createOwner('one', 'telegram')
  await commands.handle(telegram, { platform: 'telegram', chatType: 'supergroup', channelId: 'group', messageId: 'group', senderId: 'existing-owner', text: `/pair ${restricted.code}`, timestamp: 1 })
  await commands.handle(whatsapp, { platform: 'whatsapp', channelId: 'wa', messageId: 'wa', senderId: 'wa-user', text: `/pair ${restricted.code}`, timestamp: 1 })
  await commands.handle(telegram, privateMessage('second-invited', `/pair ${restricted.code}`))
  expect(owners).toEqual(['existing-owner', 'invited', 'second-invited'])
  expect(store.getAll()).toEqual([])
  expect(sent).toContain('You are now allowed to use this workspace.')
})

import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BindingStore } from '../binding-store'
import { MessageRouter } from '../router'
import type { MessagingConfig } from '../types'

test('binding key includes topic and access control denies unauthorised senders', async () => {
  const store = new BindingStore(mkdtempSync(join(tmpdir(), 'opcagent-messaging-')))
  const binding = store.bind({ workspaceId: 'one', sessionId: 's1', platform: 'telegram', channelId: 'chat', threadId: 7, config: { accessMode: 'allow-list', allowedSenderIds: ['owner'] } })
  expect(store.findByChannel('telegram', 'chat', 7)?.id).toBe(binding.id)
  expect(store.findByChannel('telegram', 'chat')).toBeUndefined()
  const config: MessagingConfig = { version: 1, enabled: true, platforms: {} }
  const delivered: string[] = []
  const router = new MessageRouter({ bindingStore: store, getConfig: () => config, sendToSession: async (_sessionId, text) => { delivered.push(text) } })
  expect(await router.route({ platform: 'telegram', channelId: 'chat', threadId: 7, messageId: 'm1', senderId: 'stranger', text: 'no', timestamp: 0 })).toBe(false)
  expect(await router.route({ platform: 'telegram', channelId: 'chat', threadId: 7, messageId: 'm2', senderId: 'owner', text: 'yes', timestamp: 0 })).toBe(true)
  expect(delivered).toEqual(['yes'])
})

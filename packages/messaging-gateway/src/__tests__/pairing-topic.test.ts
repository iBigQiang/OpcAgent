import { expect, test } from 'bun:test'
import { PairingCodeManager } from '../pairing'
import { consumePairCommand } from '../commands'
import { TopicRegistry } from '../topic-registry'

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

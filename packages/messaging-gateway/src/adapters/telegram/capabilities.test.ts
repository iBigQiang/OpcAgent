import { expect, test } from 'bun:test'
import { TelegramAdapter } from './index'

test('telegram advertises rich rendering and can update its allowed supergroup before connect', () => {
  const adapter = new TelegramAdapter()
  expect(adapter.capabilities).toMatchObject({ messageEditing: true, inlineButtons: true, maxMessageLength: 4096 })
  adapter.setAcceptedSupergroupChatId?.('-1001')
  expect(adapter.platform).toBe('telegram')
})

import { expect, test } from 'bun:test'
import { classifyTelegramConnectionError, TelegramAdapter } from './index'

test('telegram advertises rich rendering and can update its allowed supergroup before connect', () => {
  const adapter = new TelegramAdapter()
  expect(adapter.capabilities).toMatchObject({ messageEditing: true, inlineButtons: true, maxMessageLength: 4096 })
  adapter.setAcceptedSupergroupChatId?.('-1001')
  expect(adapter.platform).toBe('telegram')
})

test('telegram connection errors expose only safe stage and provider codes', () => {
  const secret = '123456:secret-token'
  const conflict = classifyTelegramConnectionError({
    error_code: 409,
    method: 'getUpdates',
    payload: { token: secret },
    description: `Conflict for ${secret}`,
  }, 'polling')
  const network = classifyTelegramConnectionError({
    error: { code: 'ETIMEDOUT', message: secret },
  }, 'verify_bot')

  expect(conflict.message).toContain('already active')
  expect(conflict.code).toBe(409)
  expect(network.message).toContain('ETIMEDOUT')
  expect(JSON.stringify({ conflict, network })).not.toContain(secret)
})

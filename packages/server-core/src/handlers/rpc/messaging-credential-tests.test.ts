import { describe, expect, mock, test } from 'bun:test'
import { RPC_CHANNELS } from '@opcagent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@opcagent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { IMessagingGatewayRegistry } from '../messaging-registry-interface'
import { HANDLED_CHANNELS, registerMessagingHandlers } from './messaging'

const context: RequestContext = { clientId: 'client', workspaceId: null, webContentsId: null }

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const testTelegramToken = mock(async () => ({ success: true, botName: 'Test Bot' }))
  const testLarkCredentials = mock(async () => ({ success: true }))
  const saveTelegramToken = mock(async () => {})
  const saveLarkCredentials = mock(async () => {})
  const registry = new Proxy({ testTelegramToken, testLarkCredentials, saveTelegramToken, saveLarkCredentials }, {
    get(target, key) {
      if (key in target) return target[key as keyof typeof target]
      return () => undefined
    },
  }) as unknown as IMessagingGatewayRegistry
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  registerMessagingHandlers(server, { messagingRegistry: registry } as unknown as HandlerDeps)
  return { handlers, testTelegramToken, testLarkCredentials, saveTelegramToken, saveLarkCredentials }
}

describe('messaging credential test RPC', () => {
  test('registers both explicit test channels', () => {
    expect(HANDLED_CHANNELS).toContain(RPC_CHANNELS.messaging.TEST_TELEGRAM)
    expect(HANDLED_CHANNELS).toContain(RPC_CHANNELS.messaging.TEST_LARK)
  })

  test('Telegram test delegates without workspace access or persistence', async () => {
    const { handlers, testTelegramToken, saveTelegramToken, saveLarkCredentials } = createHarness()
    const result = await handlers.get(RPC_CHANNELS.messaging.TEST_TELEGRAM)!(context, 'telegram-secret')

    expect(result).toEqual({ success: true, botName: 'Test Bot' })
    expect(testTelegramToken).toHaveBeenCalledWith('telegram-secret')
    expect(saveTelegramToken).toHaveBeenCalledTimes(0)
    expect(saveLarkCredentials).toHaveBeenCalledTimes(0)
  })

  test('Lark test delegates without workspace access or persistence', async () => {
    const { handlers, testLarkCredentials, saveTelegramToken, saveLarkCredentials } = createHarness()
    const credentials = { appId: 'app-id', appSecret: 'app-secret', domain: 'lark' as const }
    const result = await handlers.get(RPC_CHANNELS.messaging.TEST_LARK)!(context, credentials)

    expect(result).toEqual({ success: true })
    expect(testLarkCredentials).toHaveBeenCalledWith(credentials)
    expect(saveTelegramToken).toHaveBeenCalledTimes(0)
    expect(saveLarkCredentials).toHaveBeenCalledTimes(0)
  })
})

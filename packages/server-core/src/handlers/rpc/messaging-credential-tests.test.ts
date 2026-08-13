import { describe, expect, mock, test } from 'bun:test'
import { RPC_CHANNELS } from '@mkagent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@mkagent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { IMessagingGatewayRegistry } from '../messaging-registry-interface'
import { HANDLED_CHANNELS, registerMessagingHandlers } from './messaging'

const context: RequestContext = { clientId: 'client', workspaceId: null, webContentsId: null }

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const testTelegramToken = mock(async () => ({ success: true, botName: 'Test Bot' }))
  const testLarkCredentials = mock(async () => ({ success: true }))
  const saveCredential = mock(async () => {})
  const registry = new Proxy({ testTelegramToken, testLarkCredentials, saveCredential }, {
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
  return { handlers, testTelegramToken, testLarkCredentials, saveCredential }
}

describe('messaging credential test RPC', () => {
  test('registers both explicit test channels', () => {
    expect(HANDLED_CHANNELS).toContain(RPC_CHANNELS.messaging.TEST_TELEGRAM)
    expect(HANDLED_CHANNELS).toContain(RPC_CHANNELS.messaging.TEST_LARK)
  })

  test('Telegram test delegates without workspace access or persistence', async () => {
    const { handlers, testTelegramToken, saveCredential } = createHarness()
    const result = await handlers.get(RPC_CHANNELS.messaging.TEST_TELEGRAM)!(context, 'telegram-secret')

    expect(result).toEqual({ success: true, botName: 'Test Bot' })
    expect(testTelegramToken).toHaveBeenCalledWith('telegram-secret')
    expect(saveCredential).toHaveBeenCalledTimes(0)
  })

  test('Lark test delegates without workspace access or persistence', async () => {
    const { handlers, testLarkCredentials, saveCredential } = createHarness()
    const credentials = { appId: 'app-id', appSecret: 'app-secret', domain: 'lark' as const }
    const result = await handlers.get(RPC_CHANNELS.messaging.TEST_LARK)!(context, credentials)

    expect(result).toEqual({ success: true })
    expect(testLarkCredentials).toHaveBeenCalledWith(credentials)
    expect(saveCredential).toHaveBeenCalledTimes(0)
  })
})

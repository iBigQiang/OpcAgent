import { afterEach, describe, expect, mock, test } from 'bun:test'
import { MessagingGatewayRegistry } from '../registry'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function registry() {
  const logs: unknown[] = []
  return {
    logs,
    value: new MessagingGatewayRegistry({
      getMessagingDir() { throw new Error('credential tests must not initialize workspace state') },
      async sendToSession() {},
      logger: {
        info(...args) { logs.push(args) },
        warn(...args) { logs.push(args) },
        error(...args) { logs.push(args) },
      },
    }),
  }
}

describe('explicit messaging credential tests', () => {
  test('Telegram validates only on explicit invocation and returns sanitized bot metadata', async () => {
    const fetchMock = mock(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://api.telegram.org/bottelegram-secret/getMe')
      return Response.json({
        ok: true,
        result: { first_name: 'Test Bot', username: 'test_bot', token: 'provider-secret' },
      })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { value, logs } = registry()

    expect(fetchMock).toHaveBeenCalledTimes(0)
    expect(await value.testTelegramToken(' telegram-secret ')).toEqual({
      success: true,
      botName: 'Test Bot',
      botUsername: 'test_bot',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logs).toEqual([])
  })

  test('Telegram does not fetch empty input or expose provider and network errors', async () => {
    const fetchMock = mock(async () => Response.json({
      ok: false,
      description: 'telegram-secret is invalid',
    }, { status: 401 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { value } = registry()

    expect(await value.testTelegramToken('  ')).toEqual({ success: false, error: 'Token is required' })
    expect(fetchMock).toHaveBeenCalledTimes(0)
    expect(await value.testTelegramToken('telegram-secret')).toEqual({ success: false, error: 'Telegram rejected the token' })

    globalThis.fetch = mock(async () => { throw new Error('telegram-secret connection failed') }) as unknown as typeof fetch
    expect(await value.testTelegramToken('telegram-secret')).toEqual({ success: false, error: 'Unable to verify the Telegram token' })
  })

  test('Lark posts only explicit credentials and returns no access token or provider error', async () => {
    const fetchMock = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal')
      expect(init).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      expect(JSON.parse(String(init?.body))).toEqual({ app_id: 'app-id', app_secret: 'app-secret' })
      return Response.json({ code: 0, tenant_access_token: 'tenant-secret' })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { value, logs } = registry()

    expect(fetchMock).toHaveBeenCalledTimes(0)
    expect(await value.testLarkCredentials({ appId: ' app-id ', appSecret: ' app-secret ', domain: 'feishu' })).toEqual({ success: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logs).toEqual([])

    globalThis.fetch = mock(async () => Response.json({ code: 1, msg: 'app-secret is invalid' })) as unknown as typeof fetch
    expect(await value.testLarkCredentials({ appId: 'app-id', appSecret: 'app-secret', domain: 'lark' })).toEqual({ success: false, error: 'Lark rejected the credentials' })
  })

  test('Lark rejects incomplete or unsupported input without fetching', async () => {
    const fetchMock = mock(async () => Response.json({ code: 0, tenant_access_token: 'unused' }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { value } = registry()

    expect(await value.testLarkCredentials({ appId: '', appSecret: 'secret', domain: 'lark' })).toEqual({ success: false, error: 'App ID and App Secret are required' })
    expect(await value.testLarkCredentials({ appId: 'id', appSecret: 'secret', domain: 'invalid' as 'lark' })).toEqual({ success: false, error: 'Unsupported Lark domain' })
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })
})

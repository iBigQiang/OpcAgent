import { describe, expect, it } from 'bun:test';
import { piDriver } from './pi.ts';

describe('piDriver.buildRuntime custom endpoint models', () => {
  it('preserves explicit per-model supportsImages values', () => {
    const runtime = piDriver.buildRuntime({
      context: {
        provider: 'pi',
        authType: 'api_key',
        resolvedModel: 'vision-model',
        capabilities: { needsHttpPoolServer: false },
        connection: {
          slug: 'custom-endpoint',
          name: 'Custom Endpoint',
          providerType: 'pi',
          authType: 'api_key',
          baseUrl: 'http://127.0.0.1:11111/v1',
          customEndpoint: { api: 'anthropic-messages', supportsImages: true },
          models: [
            { id: 'vision-model', contextWindow: 262_144, supportsImages: true },
            { id: 'text-only-model', supportsImages: false },
            { id: 'plain-model' },
          ],
          createdAt: Date.now(),
        } as any,
      },
      coreConfig: {} as any,
      hostRuntime: {} as any,
      resolvedPaths: {
        piServerPath: '/tmp/pi-agent-server.js',
        interceptorBundlePath: '/tmp/interceptor.cjs',
        nodeRuntimePath: '/usr/bin/node',
      },
    });

    expect(runtime.customModels).toEqual([
      { id: 'vision-model', contextWindow: 262_144, supportsImages: true },
      { id: 'text-only-model', supportsImages: false },
      'plain-model',
    ]);
  });

  it('pins only the explicit AnyRouter Pi profile to its custom Anthropic runtime', () => {
    const runtime = piDriver.buildRuntime({
      context: {
        provider: 'pi', authType: 'api_key', resolvedModel: 'claude-sonnet-test',
        capabilities: { needsHttpPoolServer: false },
        connection: {
          slug: 'anyrouter-pi', name: 'AnyRouter Pi', providerType: 'pi_compat',
          authType: 'api_key_with_endpoint', baseUrl: 'https://anyrouter.top',
          platformProfile: 'anyrouter_pi', createdAt: Date.now(),
        },
      },
      coreConfig: {} as any, hostRuntime: {} as any,
      resolvedPaths: {
        piServerPath: '/tmp/pi-agent-server.js', interceptorBundlePath: '/tmp/interceptor.cjs', nodeRuntimePath: '/usr/bin/node',
      },
    });

    expect(runtime).toMatchObject({
      piAuthProvider: 'anthropic',
      baseUrl: 'https://anyrouter.top',
      platformProfile: 'anyrouter_pi',
      customEndpoint: { api: 'anthropic-messages' },
    });
  });
});

describe('piDriver.testConnection custom Anthropic endpoint auth', () => {
  it('mirrors the runtime x-api-key and Bearer headers', async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl = '';
    let requestHeaders: Headers | undefined;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = input.toString();
      requestHeaders = new Headers(init?.headers);
      return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', { status: 200 });
    }) as typeof fetch;

    try {
      const result = await piDriver.testConnection!({
        provider: 'pi',
        apiKey: 'test-token',
        model: 'pi/claude-opus-test',
        baseUrl: 'https://gateway.example.test',
        connection: {
          providerType: 'pi_compat',
          piAuthProvider: 'anthropic',
          customEndpoint: { api: 'anthropic-messages' },
        },
        timeoutMs: 1_000,
        resolvedPaths: {
          piServerPath: '/tmp/pi-agent-server.js',
          interceptorBundlePath: '/tmp/interceptor.cjs',
          nodeRuntimePath: '/usr/bin/node',
        },
        hostRuntime: {
          appRootPath: '/tmp/mkagent',
          isPackaged: false,
        },
      });

      expect(result).toEqual({ success: true });
      expect(requestUrl).toBe('https://gateway.example.test/v1/messages');
      expect(requestHeaders?.get('x-api-key')).toBe('test-token');
      expect(requestHeaders?.get('authorization')).toBe('Bearer test-token');
      expect(requestHeaders?.get('anthropic-version')).toBe('2023-06-01');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses the identical versioned wire for the explicit AnyRouter Pi profile', async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl = '';
    let requestHeaders: Headers | undefined;
    let requestBody: Record<string, unknown> | undefined;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = input.toString();
      requestHeaders = new Headers(init?.headers);
      requestBody = JSON.parse(String(init?.body));
      return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', { status: 200 });
    }) as typeof fetch;

    try {
      const result = await piDriver.testConnection!({
        provider: 'pi',
        apiKey: 'test-token',
        model: 'pi/claude-opus-test',
        baseUrl: 'https://anyrouter.top',
        connection: {
          providerType: 'pi_compat',
          platformProfile: 'anyrouter_pi',
        },
        timeoutMs: 1_000,
        resolvedPaths: {
          piServerPath: '/tmp/pi-agent-server.js',
          interceptorBundlePath: '/tmp/interceptor.cjs',
          nodeRuntimePath: '/usr/bin/node',
        },
        hostRuntime: { appRootPath: '/tmp/mkagent', isPackaged: false },
      });

      expect(result).toEqual({ success: true });
      expect(requestUrl).toBe('https://anyrouter.top/v1/messages?beta=true');
      expect(requestHeaders?.get('authorization')).toBe('Bearer test-token');
      expect(requestHeaders?.has('x-api-key')).toBe(false);
      expect(requestHeaders?.get('x-claude-code-session-id')).toBeTruthy();
      expect(requestBody).toMatchObject({
        model: 'claude-opus-test',
        stream: true,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not treat HTTP 200 with an SSE error as a successful AnyRouter Pi test', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(
      'event: error\ndata: {"type":"error","error":{"type":"rate_limit_error","message":"Rate limit reached"}}\n\n',
      { status: 200 },
    )) as unknown as typeof fetch;

    try {
      const result = await piDriver.testConnection!({
        provider: 'pi',
        apiKey: 'test-token',
        model: 'claude-opus-test',
        baseUrl: 'https://anyrouter.top',
        connection: { providerType: 'pi_compat', platformProfile: 'anyrouter_pi' },
        timeoutMs: 1_000,
        resolvedPaths: {
          piServerPath: '/tmp/pi-agent-server.js',
          interceptorBundlePath: '/tmp/interceptor.cjs',
          nodeRuntimePath: '/usr/bin/node',
        },
        hostRuntime: { appRootPath: '/tmp/mkagent', isPackaged: false },
      });

      expect(result).toEqual({ success: false, error: 'Rate limit reached' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

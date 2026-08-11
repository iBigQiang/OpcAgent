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
});

describe('piDriver.testConnection custom Anthropic endpoint auth', () => {
  it('mirrors the runtime x-api-key and Bearer headers', async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl = '';
    let requestHeaders: Headers | undefined;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = input.toString();
      requestHeaders = new Headers(init?.headers);
      return new Response('', { status: 200 });
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
});

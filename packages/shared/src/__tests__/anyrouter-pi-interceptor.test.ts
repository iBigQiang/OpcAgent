import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

let createAnyRouterPiSseProcessor: typeof import('../unified-network-interceptor.ts').createAnyRouterPiSseProcessor;
let isAnyRouterPiMessagesUrl: typeof import('../unified-network-interceptor.ts').isAnyRouterPiMessagesUrl;
let originalFetch: typeof globalThis.fetch;
let observedRequest: { url: string; init?: RequestInit } | undefined;

function getObservedRequest(): { url: string; init?: RequestInit } | undefined {
  return observedRequest;
}

beforeAll(async () => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    observedRequest = {
      url: typeof input === 'string' ? input : input.toString(),
      init,
    };
    return new Response('', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  delete process.env.MKAGENT_INTERCEPTOR_DISABLE_AUTO_INSTALL;
  ({ createAnyRouterPiSseProcessor, isAnyRouterPiMessagesUrl } = await import('../unified-network-interceptor.ts'));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  delete process.env.MKAGENT_INTERCEPTOR_DISABLE_AUTO_INSTALL;
  delete process.env.MKAGENT_PLATFORM_PROFILE;
  delete process.env.MKAGENT_PI_MODEL_API;
  delete process.env.MKAGENT_PI_MODEL_PROVIDER;
  delete process.env.MKAGENT_PI_MODEL_BASE_URL;
});

describe('AnyRouter Pi interceptor SSE', () => {
  it('matches only the AnyRouter messages endpoint', () => {
    expect(isAnyRouterPiMessagesUrl('https://anyrouter.top/v1/messages')).toBe(true);
    expect(isAnyRouterPiMessagesUrl('https://anyrouter.top/v1/messages?beta=true')).toBe(true);
    expect(isAnyRouterPiMessagesUrl('https://anyrouter.top/v1/responses')).toBe(false);
    expect(isAnyRouterPiMessagesUrl('https://example.com/v1/messages')).toBe(false);
  });

  it('does not apply the AnyRouter-Pi wire to AgentRouter requests', async () => {
    process.env.MKAGENT_PLATFORM_PROFILE = 'agentrouter';
    delete process.env.MKAGENT_PI_MODEL_API;
    delete process.env.MKAGENT_PI_MODEL_PROVIDER;
    delete process.env.MKAGENT_PI_MODEL_BASE_URL;
    observedRequest = undefined;

    await globalThis.fetch('https://anyrouter.top/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-only-key' },
      body: JSON.stringify({ model: 'third-party-model', max_tokens: 32, messages: [] }),
    });

    const capturedRequest = getObservedRequest();
    if (!capturedRequest) throw new Error('Expected the intercepted request to reach the fetch stub');

    expect(capturedRequest.url).toBe('https://anyrouter.top/v1/messages');
    expect(new Headers(capturedRequest.init?.headers).get('x-api-key')).toBe('test-only-key');
    expect(new Headers(capturedRequest.init?.headers).get('authorization')).toBeNull();
    expect(JSON.parse(capturedRequest.init?.body as string)).toMatchObject({
      model: 'third-party-model',
      max_tokens: 32,
    });
  });

  it('keeps native Anthropic text deltas consumable by Pi', async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n'));
        controller.enqueue(encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
        controller.close();
      },
    });

    const reader = input.pipeThrough(createAnyRouterPiSseProcessor()).getReader();
    let output = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();

    expect(output).toContain('event: content_block_delta');
    expect(output).toContain('"type":"text_delta","text":"Hello"');
    expect(output).toContain('event: message_stop');
  });

  it('translates a streamed Claude Code Read call to Pi without losing input', async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const sse = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"file_path\\":\\"/tmp/a\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    ];
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const item of sse) controller.enqueue(encoder.encode(item));
        controller.close();
      },
    });
    const reader = input.pipeThrough(createAnyRouterPiSseProcessor()).getReader();
    let output = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();

    expect(output).toContain('"name":"read"');
    expect(output).toContain('"partial_json":"{\\"path\\":\\"/tmp/a\\"}"');
  });
});

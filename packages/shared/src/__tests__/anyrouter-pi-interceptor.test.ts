import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  _flushAnyRouterPiDiagnosticsForTesting,
  _resetAnyRouterPiDiagnosticsForTesting,
  createAnyRouterPiDiagnosticRecord,
  getAnyRouterPiDiagnosticsPath,
  writeAnyRouterPiDiagnostic,
} from '../anyrouter-pi-diagnostics.ts';

let createAnyRouterPiSseProcessor: typeof import('../unified-network-interceptor.ts').createAnyRouterPiSseProcessor;
let isAnyRouterPiMessagesUrl: typeof import('../unified-network-interceptor.ts').isAnyRouterPiMessagesUrl;
let originalFetch: typeof globalThis.fetch;
let observedRequest: { url: string; init?: RequestInit } | undefined;
let observedFetchError: Error | undefined;
let observedFetchCalls = 0;

function getObservedRequest(): { url: string; init?: RequestInit } | undefined {
  return observedRequest;
}

beforeAll(async () => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    observedFetchCalls += 1;
    observedRequest = {
      url: typeof input === 'string' ? input : input.toString(),
      init,
    };
    if (observedFetchError) throw observedFetchError;
    return new Response('', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  delete process.env.OPCAGENT_INTERCEPTOR_DISABLE_AUTO_INSTALL;
  ({ createAnyRouterPiSseProcessor, isAnyRouterPiMessagesUrl } = await import('../unified-network-interceptor.ts'));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  delete process.env.OPCAGENT_INTERCEPTOR_DISABLE_AUTO_INSTALL;
  delete process.env.OPCAGENT_PLATFORM_PROFILE;
  delete process.env.OPCAGENT_PI_MODEL_API;
  delete process.env.OPCAGENT_PI_MODEL_PROVIDER;
  delete process.env.OPCAGENT_PI_MODEL_BASE_URL;
  delete process.env.OPCAGENT_ANYROUTER_PI_DIAGNOSTICS;
  delete process.env.OPCAGENT_ANYROUTER_PI_WIRE_VARIANT;
  delete process.env.OPCAGENT_SESSION_DIR;
});

describe('AnyRouter Pi interceptor SSE', () => {
  it('matches only the configured messages endpoint', () => {
    const configuredBaseUrl = 'https://overseas.example.test';
    expect(isAnyRouterPiMessagesUrl('https://overseas.example.test/v1/messages', configuredBaseUrl)).toBe(true);
    expect(isAnyRouterPiMessagesUrl('https://overseas.example.test/v1/messages?beta=true', configuredBaseUrl)).toBe(true);
    expect(isAnyRouterPiMessagesUrl('https://overseas.example.test/v1/responses', configuredBaseUrl)).toBe(false);
    expect(isAnyRouterPiMessagesUrl('https://anyrouter.top/v1/messages', configuredBaseUrl)).toBe(false);
  });

  it('does not apply the AnyRouter-Pi wire to AgentRouter requests', async () => {
    process.env.OPCAGENT_PLATFORM_PROFILE = 'agentrouter';
    delete process.env.OPCAGENT_PI_MODEL_API;
    delete process.env.OPCAGENT_PI_MODEL_PROVIDER;
    delete process.env.OPCAGENT_PI_MODEL_BASE_URL;
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

  it('writes only the allowlisted privacy-safe diagnostic fields', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opcagent-anyrouter-diagnostics-'));
    const filePath = join(root, 'diagnostics.jsonl');
    _resetAnyRouterPiDiagnosticsForTesting();

    writeAnyRouterPiDiagnostic({
      event: 'request_end',
      correlationId: '12345678-1234-1234-1234-123456789abc',
      sdkRetryHeader: '2',
      status: 429,
      durationMs: 3456,
      retryAfterHeader: '7',
      configuredModel: 'claude-opus-5[1m]',
      outboundModel: 'claude-opus-5',
      requestUrl: 'https://secret-host.example/v1/messages?token=must-not-leak',
      variant: 'baseline',
      maxTokens: 64_000,
      outboundRetryHeader: '0',
    }, { enabled: true, filePath, nowMs: 0 });
    await _flushAnyRouterPiDiagnosticsForTesting();

    const text = readFileSync(filePath, 'utf8');
    const record = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(record)).toEqual([
      'timestamp', 'event', 'correlationId', 'attempt', 'status', 'durationMs',
      'retryAfter', 'configuredModel', 'outboundModel', 'requestPath', 'variant',
      'maxTokens', 'retryHeader',
    ]);
    expect(record).toEqual(createAnyRouterPiDiagnosticRecord({
      event: 'request_end',
      correlationId: '12345678-1234-1234-1234-123456789abc',
      sdkRetryHeader: '2',
      status: 429,
      durationMs: 3456,
      retryAfterHeader: '7',
      configuredModel: 'claude-opus-5[1m]',
      outboundModel: 'claude-opus-5',
      requestUrl: 'https://secret-host.example/v1/messages?token=must-not-leak',
      variant: 'baseline',
      maxTokens: 64_000,
      outboundRetryHeader: '0',
    }, 0) as unknown as Record<string, unknown>);
    expect(text).not.toContain('secret-host');
    expect(text).not.toContain('must-not-leak');
    expect(text).not.toContain('Authorization');
    expect(text).not.toContain('Bearer');
    expect(record.requestPath).toBe('/v1/messages');
    expect(record.attempt).toBe(3);
    expect(record.retryAfter).toBe(7);
    unlinkSync(filePath);
    rmdirSync(root);
  });

  it('rotates per-process diagnostics without changing the request schema', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opcagent-anyrouter-rotation-'));
    const filePath = join(root, 'diagnostics.jsonl');
    _resetAnyRouterPiDiagnosticsForTesting();
    const input = {
      event: 'request_start' as const,
      correlationId: '12345678-1234-1234-1234-123456789abc',
      durationMs: 0,
      configuredModel: 'claude-opus-5[1m]',
      outboundModel: 'claude-opus-5',
      requestUrl: 'https://example.test/v1/messages?beta=true',
      variant: 'baseline' as const,
      maxTokens: 64_000,
      outboundRetryHeader: '0',
    };
    writeAnyRouterPiDiagnostic(input, { enabled: true, filePath, maxBytes: 1 });
    writeAnyRouterPiDiagnostic(input, { enabled: true, filePath, maxBytes: 1 });
    await _flushAnyRouterPiDiagnosticsForTesting();
    expect(JSON.parse(readFileSync(filePath, 'utf8')).requestPath).toBe('/v1/messages');
    expect(JSON.parse(readFileSync(`${filePath}.1`, 'utf8')).requestPath).toBe('/v1/messages');
    unlinkSync(filePath);
    unlinkSync(`${filePath}.1`);
    rmdirSync(root);
  });

  it('records the selected A/B variant through the real interceptor boundary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opcagent-anyrouter-integration-'));
    process.env.OPCAGENT_SESSION_DIR = root;
    process.env.OPCAGENT_ANYROUTER_PI_DIAGNOSTICS = '1';
    process.env.OPCAGENT_ANYROUTER_PI_WIRE_VARIANT = 'preserve-max-tokens';
    process.env.OPCAGENT_PLATFORM_PROFILE = 'anyrouter_pi';
    process.env.OPCAGENT_PI_MODEL_API = 'anthropic-messages';
    process.env.OPCAGENT_PI_MODEL_BASE_URL = 'https://gateway.example.test';
    observedRequest = undefined;
    _resetAnyRouterPiDiagnosticsForTesting();

    const requestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'must-not-leak-key',
        'x-stainless-retry-count': '1',
      },
      body: JSON.stringify({
        model: 'claude-opus-5[1m]',
        max_tokens: 8192,
        messages: [{ role: 'user', content: 'must-not-leak-prompt' }],
      }),
    } satisfies RequestInit;
    await globalThis.fetch('https://gateway.example.test/v1/messages?private=query', requestInit);
    await globalThis.fetch('https://gateway.example.test/v1/messages?private=query', requestInit);
    await _flushAnyRouterPiDiagnosticsForTesting();

    const capturedRequest = getObservedRequest();
    if (!capturedRequest) throw new Error('Expected the AnyRouter-Pi request to reach the fetch stub');
    const outboundBody = JSON.parse(capturedRequest.init?.body as string);
    expect(outboundBody.model).toBe('claude-opus-5');
    expect(outboundBody.max_tokens).toBe(8192);

    const diagnosticPath = getAnyRouterPiDiagnosticsPath();
    const diagnosticText = readFileSync(diagnosticPath, 'utf8');
    const records = diagnosticText.trim().split('\n').map(line => JSON.parse(line));
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({
      event: 'request_start', attempt: 2, variant: 'preserve-max-tokens', maxTokens: 8192,
    });
    expect(records[1]).toMatchObject({
      event: 'request_end', attempt: 2, status: 200, variant: 'preserve-max-tokens', maxTokens: 8192,
    });
    expect(records[0].correlationId).toBe(records[1].correlationId);
    expect(records[2].correlationId).toBe(records[3].correlationId);
    expect(records[0].correlationId).not.toBe(records[2].correlationId);
    expect(diagnosticText).not.toContain('must-not-leak');
    expect(diagnosticText).not.toContain('gateway.example.test');
    expect(diagnosticText).not.toContain('?private=query');

    delete process.env.OPCAGENT_SESSION_DIR;
    delete process.env.OPCAGENT_ANYROUTER_PI_DIAGNOSTICS;
    delete process.env.OPCAGENT_ANYROUTER_PI_WIRE_VARIANT;
    delete process.env.OPCAGENT_PLATFORM_PROFILE;
    delete process.env.OPCAGENT_PI_MODEL_API;
    delete process.env.OPCAGENT_PI_MODEL_BASE_URL;
    unlinkSync(diagnosticPath);
    rmdirSync(root);
  });

  it('does not resend an unmodified AnyRouter-Pi request after a network failure', async () => {
    process.env.OPCAGENT_PLATFORM_PROFILE = 'anyrouter_pi';
    process.env.OPCAGENT_PI_MODEL_API = 'anthropic-messages';
    process.env.OPCAGENT_PI_MODEL_BASE_URL = 'https://gateway.example.test';
    observedFetchError = new Error('simulated network failure');
    const callsBefore = observedFetchCalls;

    try {
      await expect(globalThis.fetch('https://gateway.example.test/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'test-only-key' },
        body: JSON.stringify({
          model: 'claude-opus-5[1m]',
          max_tokens: 8192,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      })).rejects.toThrow('simulated network failure');
      expect(observedFetchCalls - callsBefore).toBe(1);
    } finally {
      observedFetchError = undefined;
      delete process.env.OPCAGENT_PLATFORM_PROFILE;
      delete process.env.OPCAGENT_PI_MODEL_API;
      delete process.env.OPCAGENT_PI_MODEL_BASE_URL;
    }
  });

  it('silently disables diagnostics after an I/O failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opcagent-anyrouter-io-failure-'));
    const blockingFile = join(root, 'not-a-directory');
    writeFileSync(blockingFile, 'block');
    _resetAnyRouterPiDiagnosticsForTesting();
    const input = {
      event: 'request_start' as const,
      correlationId: '12345678-1234-1234-1234-123456789abc',
      durationMs: 0,
      configuredModel: 'claude-opus-5[1m]',
      outboundModel: 'claude-opus-5',
      requestUrl: 'https://example.test/v1/messages',
      variant: 'baseline' as const,
      maxTokens: 64_000,
      outboundRetryHeader: '0',
    };
    expect(() => writeAnyRouterPiDiagnostic(input, {
      enabled: true,
      filePath: join(blockingFile, 'diagnostics.jsonl'),
    })).not.toThrow();
    await _flushAnyRouterPiDiagnosticsForTesting();
    expect(() => writeAnyRouterPiDiagnostic(input, {
      enabled: true,
      filePath: join(root, 'would-have-been-created.jsonl'),
    })).not.toThrow();
    await _flushAnyRouterPiDiagnosticsForTesting();
    expect(() => readFileSync(join(root, 'would-have-been-created.jsonl'))).toThrow();
    _resetAnyRouterPiDiagnosticsForTesting();
    unlinkSync(blockingFile);
    rmdirSync(root);
  });
});

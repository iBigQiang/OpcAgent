import { describe, expect, it } from 'bun:test';
import {
  adaptAnyRouterPiRequest,
  ANYROUTER_PI_PROFILE,
  adaptAnyRouterPiToolInput,
  adaptAnyRouterPiToolName,
  resolveAnyRouterPiWireVariant,
} from './anyrouter-pi-wire.ts';

describe('AnyRouter Pi wire', () => {
  it('uses the versioned Claude Code request snapshot', () => {
    const result = adaptAnyRouterPiRequest({
      url: 'https://gateway.example.test/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-token',
        'content-length': '999',
      },
      body: {
        model: 'claude-opus-test[1m]',
        max_tokens: 32,
        system: 'Original Pi system prompt',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [{
          name: 'read',
          description: 'Read a local file',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        }],
      },
      sessionId: 'session-123',
      deviceId: 'device-456',
    });

    expect(result.url).toBe('https://gateway.example.test/v1/messages?beta=true');
    expect(result.headers.get('authorization')).toBe('Bearer test-token');
    expect(result.headers.has('x-api-key')).toBe(false);
    expect(result.headers.has('content-length')).toBe(false);
    expect(result.headers.get('user-agent')).toBe('claude-cli/2.1.227 (external, sdk-cli)');
    expect(result.headers.get('x-claude-code-session-id')).toBe('session-123');
    expect(result.headers.get('anthropic-beta')).toContain('claude-code-20250219');

    expect(result.body).toMatchObject({
      model: 'claude-opus-test',
      stream: true,
      max_tokens: 64_000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    });
    expect(result.body.system).toHaveLength(3);
    expect(result.body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Agent' }),
      expect.objectContaining({ name: 'Bash' }),
      expect.objectContaining({ name: 'Read', description: 'Read a local file' }),
      expect.objectContaining({ name: 'Write' }),
    ]));
    const readTool = (result.body.tools as Array<Record<string, unknown>>)
      .find(tool => tool.name === 'Read');
    expect(readTool?.input_schema).toEqual({
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    });
    expect(result.body.metadata).toEqual({
      user_id: JSON.stringify({ device_id: 'device-456', account_uuid: '', session_id: 'session-123' }),
    });
    const messages = result.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]?.content).toEqual([{ type: 'text', text: 'Hello', cache_control: { type: 'ephemeral' } }]);
    expect(messages.at(-1)).toMatchObject({ role: 'system' });
  });

  it('keeps a prior Pi tool round intact before adding the compatibility turn', () => {
    const result = adaptAnyRouterPiRequest({
      url: 'https://ignored.example/v1/messages',
      headers: { authorization: 'Bearer existing' },
      body: {
        model: 'claude-sonnet-test',
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'read', input: { path: '/tmp/a' } }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file text' }] },
          { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
        ],
      },
      sessionId: 'session-2',
      deviceId: 'device-2',
    });

    const messages = result.body.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({ role: 'assistant' });
    expect(messages[1]).toMatchObject({ role: 'user' });
    expect((messages[2]?.content as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: 'text', text: 'Continue', cache_control: { type: 'ephemeral' },
    });
    expect(messages[3]).toMatchObject({ role: 'system' });
  });

  it('changes exactly one request field for each diagnostic A/B variant', () => {
    const makeRequest = (variant: Parameters<typeof adaptAnyRouterPiRequest>[0]['variant']) =>
      adaptAnyRouterPiRequest({
        url: 'https://gateway.example.test/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-token',
          'x-stainless-retry-count': '2',
        },
        body: {
          model: 'claude-opus-test[1m]',
          max_tokens: 8192,
          messages: [{ role: 'user', content: 'Hello' }],
        },
        sessionId: 'session-ab',
        deviceId: 'device-ab',
        variant,
      });

    const baseline = makeRequest('baseline');
    const modelAlias = makeRequest('preserve-model-alias');
    const maxTokens = makeRequest('preserve-max-tokens');
    const retryCount = makeRequest('preserve-retry-count');
    const bodyWith = (
      body: Record<string, unknown>,
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({ ...body, ...overrides });
    const headerRecord = (headers: Headers): Record<string, string> =>
      Object.fromEntries(headers);

    expect(baseline.body.model).toBe('claude-opus-test');
    expect(baseline.body.max_tokens).toBe(64_000);
    expect(baseline.headers.get('x-stainless-retry-count')).toBe('0');

    expect(modelAlias.body.model).toBe('claude-opus-test[1m]');
    expect(modelAlias.body.max_tokens).toBe(64_000);
    expect(modelAlias.headers.get('x-stainless-retry-count')).toBe('0');

    expect(maxTokens.body.model).toBe('claude-opus-test');
    expect(maxTokens.body.max_tokens).toBe(8192);
    expect(maxTokens.headers.get('x-stainless-retry-count')).toBe('0');

    expect(retryCount.body.model).toBe('claude-opus-test');
    expect(retryCount.body.max_tokens).toBe(64_000);
    expect(retryCount.headers.get('x-stainless-retry-count')).toBe('2');

    expect(bodyWith(modelAlias.body, { model: baseline.body.model })).toEqual(baseline.body);
    expect(headerRecord(modelAlias.headers)).toEqual(headerRecord(baseline.headers));
    expect(bodyWith(maxTokens.body, { max_tokens: baseline.body.max_tokens })).toEqual(baseline.body);
    expect(headerRecord(maxTokens.headers)).toEqual(headerRecord(baseline.headers));
    expect(retryCount.body).toEqual(baseline.body);
    const normalizedRetryHeaders = headerRecord(retryCount.headers);
    normalizedRetryHeaders['x-stainless-retry-count'] =
      baseline.headers.get('x-stainless-retry-count') ?? '';
    expect(normalizedRetryHeaders).toEqual(headerRecord(baseline.headers));
  });

  it('falls back safely for invalid variants and max token inputs', () => {
    expect(resolveAnyRouterPiWireVariant('unknown')).toBe('baseline');
    const result = adaptAnyRouterPiRequest({
      url: 'https://gateway.example.test/v1/messages',
      body: { model: 'test[1m]', max_tokens: -1, messages: [] },
      sessionId: 'session-safe',
      deviceId: 'device-safe',
      variant: 'preserve-max-tokens',
    });
    expect(result.body.max_tokens).toBe(64_000);
  });

  it('is enabled only by the explicit Pi profile identifier', () => {
    expect(ANYROUTER_PI_PROFILE).toBe('anyrouter_pi');
    expect(ANYROUTER_PI_PROFILE).not.toBe('anyrouter');
  });

  it('translates a safe Claude Code file tool call back to Pi', () => {
    expect(adaptAnyRouterPiToolName('Read')).toBe('read');
    expect(adaptAnyRouterPiToolInput('edit', {
      file_path: '/tmp/a.txt', old_string: 'before', new_string: 'after',
    })).toEqual({ path: '/tmp/a.txt', oldText: 'before', newText: 'after' });
  });
});

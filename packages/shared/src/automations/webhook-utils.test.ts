/**
 * Tests for webhook utility functions (expandWebhookAction, etc.)
 */

import { describe, it, expect, mock, spyOn } from 'bun:test';
import { executeWebhookRequest, executeWithRetry, expandWebhookAction, validatePublicWebhookUrl } from './webhook-utils.ts';
import type { WebhookAction } from './types.ts';

const env = {
  MKAGENT_WH_SESSION_ID: 'sess-123',
  MKAGENT_WH_EVENT: 'LabelAdd',
  API_TOKEN: 'tok-secret',
};

describe('expandWebhookAction', () => {
  it('expands URL templates', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com/hook/${MKAGENT_WH_SESSION_ID}',
    };
    const result = expandWebhookAction(action, env);
    expect(result.url).toBe('https://api.example.com/hook/sess-123');
  });

  it('expands header values', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com',
      headers: { 'X-Event': '${MKAGENT_WH_EVENT}', 'X-Static': 'unchanged' },
    };
    const result = expandWebhookAction(action, env);
    expect(result.headers).toEqual({ 'X-Event': 'LabelAdd', 'X-Static': 'unchanged' });
  });

  it('expands string body', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com',
      body: 'session=${MKAGENT_WH_SESSION_ID}',
      bodyFormat: 'raw',
    };
    const result = expandWebhookAction(action, env);
    expect(result.body).toBe('session=sess-123');
  });

  it('expands object body (JSON)', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com',
      body: { id: '${MKAGENT_WH_SESSION_ID}', event: '${MKAGENT_WH_EVENT}' },
    };
    const result = expandWebhookAction(action, env);
    expect(result.body).toEqual({ id: 'sess-123', event: 'LabelAdd' });
  });

  it('expands basic auth credentials', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com',
      auth: { type: 'basic', username: '${MKAGENT_WH_SESSION_ID}', password: '${API_TOKEN}' },
    };
    const result = expandWebhookAction(action, env);
    expect(result.auth).toEqual({ type: 'basic', username: 'sess-123', password: 'tok-secret' });
  });

  it('expands bearer auth token', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com',
      auth: { type: 'bearer', token: '${API_TOKEN}' },
    };
    const result = expandWebhookAction(action, env);
    expect(result.auth).toEqual({ type: 'bearer', token: 'tok-secret' });
  });

  it('passes through fields without templates unchanged', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com/static',
      method: 'PUT',
      bodyFormat: 'json',
      captureResponse: true,
    };
    const result = expandWebhookAction(action, env);
    expect(result.url).toBe('https://api.example.com/static');
    expect(result.method).toBe('PUT');
    expect(result.bodyFormat).toBe('json');
    expect(result.captureResponse).toBe(true);
  });
});

describe('executeWebhookRequest security', () => {
  it('rejects non-http URLs without issuing a request', async () => {
    const result = await executeWebhookRequest({ type: 'webhook', url: 'file:///etc/passwd' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('only http and https');
  });

  it('rejects embedded URL credentials and keeps the result redacted', async () => {
    const result = await executeWebhookRequest({ type: 'webhook', url: 'https://secret:canary@example.test/hook' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('embedded credentials');
    expect(result.url).not.toContain('secret');
    expect(result.url).not.toContain('canary');
  });

  it('rejects loopback, private, link-local and cloud metadata destinations', async () => {
    for (const url of [
      'http://localhost/hook',
      'http://127.0.0.1/hook',
      'http://10.1.2.3/hook',
      'http://172.16.0.1/hook',
      'http://192.168.1.1/hook',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/hook',
      'http://[fc00::1]/hook',
    ]) {
      const result = await executeWebhookRequest({ type: 'webhook', url });
      expect(result.success).toBe(false);
      expect(result.error).toContain('public network address');
    }
  });

  it('accepts a literal public destination during validation', async () => {
    await expect(validatePublicWebhookUrl('https://1.1.1.1/hook')).resolves.toBeInstanceOf(URL);
  });

  it('rejects a redirect to a private destination before following it', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private' },
    }));

    const result = await executeWebhookRequest({ type: 'webhook', url: 'https://1.1.1.1/start' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('public network address');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('aborts a slow public request at the configured timeout', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((_url: string | URL | Request, init?: RequestInit) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch);

    const result = await executeWebhookRequest({ type: 'webhook', url: 'https://1.1.1.1/slow' }, { timeoutMs: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Request timed out after 1ms');
    fetchSpy.mockRestore();
  });

  it('does not retry a 4xx response but bounds retries for 5xx responses', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('bad request', { status: 400, statusText: 'Bad Request' }));
    const clientError = await executeWithRetry(
      { type: 'webhook', url: 'https://1.1.1.1/client-error' },
      { retry: { maxAttempts: 2, initialDelayMs: 0 } },
    );
    expect(clientError.attempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockReset()
      .mockResolvedValue(new Response('unavailable', { status: 503, statusText: 'Unavailable' }));
    const serverError = await executeWithRetry(
      { type: 'webhook', url: 'https://1.1.1.1/server-error' },
      { retry: { maxAttempts: 2, initialDelayMs: 0 } },
    );
    expect(serverError.attempts).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    fetchSpy.mockRestore();
  });

  it('never includes path secrets in URL results or errors', async () => {
    const secret = 'path-secret-canary';
    const result = await executeWebhookRequest({ type: 'webhook', url: `file:///${secret}` });
    expect(result.url).not.toContain(secret);
    expect(result.error).not.toContain(secret);
  });
});

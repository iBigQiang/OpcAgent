import { beforeAll, describe, expect, it } from 'bun:test';

let resolveAdapterNameFromPiApiHint: typeof import('../unified-network-interceptor.ts').resolveAdapterNameFromPiApiHint;
let resolveExactCustomRequestUrl: typeof import('../unified-network-interceptor.ts').resolveExactCustomRequestUrl;

describe('unified-network-interceptor Pi API hint mapping', () => {
  beforeAll(async () => {
    process.env.OPCAGENT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    ({ resolveAdapterNameFromPiApiHint, resolveExactCustomRequestUrl } = await import('../unified-network-interceptor.ts'));
  });

  it('maps anthropic-messages to anthropic adapter', () => {
    expect(resolveAdapterNameFromPiApiHint('anthropic-messages')).toBe('anthropic');
  });

  it('maps openai-completions to openai adapter', () => {
    expect(resolveAdapterNameFromPiApiHint('openai-completions')).toBe('openai');
  });

  it('maps responses-family APIs to responses adapter', () => {
    expect(resolveAdapterNameFromPiApiHint('openai-responses')).toBe('openai-responses');
    expect(resolveAdapterNameFromPiApiHint('azure-openai-responses')).toBe('openai-responses');
  });

  it('returns undefined for unknown/empty hints', () => {
    expect(resolveAdapterNameFromPiApiHint(undefined)).toBeUndefined();
    expect(resolveAdapterNameFromPiApiHint('')).toBeUndefined();
    expect(resolveAdapterNameFromPiApiHint('google-generative-ai')).toBeUndefined();
  });

  it('replaces an SDK-generated Chat path only when an exact URL is configured', () => {
    expect(resolveExactCustomRequestUrl(
      'https://gateway.example.test/v1/chat/completions',
      'https://gateway.example.test/custom/invoke',
    )).toBe('https://gateway.example.test/custom/invoke');
    expect(resolveExactCustomRequestUrl('https://gateway.example.test/v1/chat/completions'))
      .toBe('https://gateway.example.test/v1/chat/completions');
  });
});

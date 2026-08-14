/**
 * Tests for LLM connection utilities (llm-connections.ts).
 *
 * Focuses on getMiniModel() / findSmallModel() — the provider-aware small
 * model resolution used for title generation, summarization, and call_llm.
 */
import { describe, it, expect } from 'bun:test';
import {
  getMiniModel,
  getPiAuthProviderForCustomEndpointApi,
  getSummarizationModel,
  isDeniedMiniModelId,
  normalizeCustomEndpointUrl,
  normalizePlatformProfileBaseUrl,
} from '../src/config/llm-connections.ts';
import type { CustomEndpointApi, LlmProviderType } from '../src/config/llm-connections.ts';

// ============================================================
// Helpers
// ============================================================

function makeConnection(providerType: LlmProviderType, models: string[], piAuthProvider?: string) {
  return { providerType, models, piAuthProvider };
}

// ============================================================
// getMiniModel / findSmallModel
// ============================================================

describe('getMiniModel()', () => {
  // --- Anthropic providers ---

  it('finds haiku for anthropic provider', () => {
    const conn = makeConnection('pi', [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ]);
    expect(getMiniModel(conn)).toBe('claude-haiku-4-5-20251001');
  });

  // --- Pi providers ---

  it('finds mini for pi provider', () => {
    const conn = makeConnection('pi', [
      'pi/gpt-5.2-codex',
      'pi/gpt-5.1-codex-mini',
    ]);
    expect(getMiniModel(conn)).toBe('pi/gpt-5.1-codex-mini');
  });

  it('skips denied codex-mini-latest alias for pi provider', () => {
    const conn = makeConnection('pi', [
      'pi/codex-mini-latest',
      'pi/gpt-5.1-codex-mini',
      'pi/gpt-5.2-codex',
    ]);
    expect(getMiniModel(conn)).toBe('pi/gpt-5.1-codex-mini');
  });

  it('skips denied pi/codex-mini-latest alias for pi provider', () => {
    const conn = makeConnection('pi', [
      'pi/codex-mini-latest',
      'pi/gpt-5.1-codex-mini',
      'pi/gpt-5.3-codex',
    ]);
    expect(getMiniModel(conn)).toBe('pi/gpt-5.1-codex-mini');
  });

  it('finds mini for pi_compat provider', () => {
    const conn = makeConnection('pi_compat', [
      'openai/gpt-5.2-codex',
      'openai/gpt-5.1-codex-mini',
    ]);
    expect(getMiniModel(conn)).toBe('openai/gpt-5.1-codex-mini');
  });

  // --- Pi fallback behavior ---

  it('finds mini for Pi list with mixed models', () => {
    const conn = makeConnection('pi', [
      'pi/claude-sonnet-4.6',
      'pi/gpt-5',
      'pi/gpt-5-mini',
      'pi/o3',
    ]);
    expect(getMiniModel(conn)).toBe('pi/gpt-5-mini');
  });

  it('finds mini even when model name has "mini" in different position', () => {
    const conn = makeConnection('pi', [
      'pi/gpt-5',
      'pi/o4-mini',
      'pi/claude-sonnet-4.6',
    ]);
    expect(getMiniModel(conn)).toBe('pi/o4-mini');
  });

  it('falls back to last model when Pi list has no mini/flash model', () => {
    const conn = makeConnection('pi', [
      'pi/gpt-5',
      'pi/claude-sonnet-4.6',
      'pi/o3',
    ]);
    expect(getMiniModel(conn)).toBe('pi/o3');
  });

  // --- Edge cases ---

  it('returns undefined for empty model list', () => {
    const conn = makeConnection('pi', []);
    expect(getMiniModel(conn)).toBeUndefined();
  });

  it('returns undefined for undefined models', () => {
    const conn = { providerType: 'pi' as LlmProviderType, models: undefined };
    expect(getMiniModel(conn)).toBeUndefined();
  });

  it('falls back to last model when no keyword match', () => {
    const conn = makeConnection('pi', [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
    ]);
    // No haiku in list — falls back to last model
    expect(getMiniModel(conn)).toBe('claude-sonnet-4-6');
  });

  it('fallback ignores denied alias and returns last allowed model', () => {
    const conn = makeConnection('pi', [
      'pi/codex-mini-latest',
      'pi/gpt-5',
      'pi/claude-sonnet-4.6',
    ]);
    expect(getMiniModel(conn)).toBe('pi/claude-sonnet-4.6');
  });

  it('handles single-model list', () => {
    const conn = makeConnection('pi', ['pi/gpt-5']);
    expect(getMiniModel(conn)).toBe('pi/gpt-5');
  });
});

// ============================================================
// getSummarizationModel (same logic, but separate function)
// ============================================================

describe('getSummarizationModel()', () => {
  it('returns same result as getMiniModel (shared implementation)', () => {
    const conn = makeConnection('pi', [
      'pi/gpt-5',
      'pi/gpt-5-mini',
      'pi/claude-sonnet-4.6',
    ]);
    expect(getSummarizationModel(conn)).toBe(getMiniModel(conn));
  });
});

describe('getMiniModel() — auth-flavor awareness', () => {
  it('skips *codex-mini* variants under openai-codex auth', () => {
    const conn = makeConnection(
      'pi',
      ['pi/gpt-5.2-codex', 'pi/gpt-5.1-codex-mini', 'pi/gpt-5-mini'],
      'openai-codex',
    );
    expect(getMiniModel(conn)).toBe('pi/gpt-5-mini');
  });

  it('still returns *codex-mini* variants under regular openai auth', () => {
    const conn = makeConnection(
      'pi',
      ['pi/gpt-5.2-codex', 'pi/gpt-5.1-codex-mini'],
      'openai',
    );
    expect(getMiniModel(conn)).toBe('pi/gpt-5.1-codex-mini');
  });

  it('falls back to last allowed model when every mini candidate is denied', () => {
    const conn = makeConnection(
      'pi',
      ['pi/gpt-5', 'pi/gpt-5.1-codex-mini', 'pi/gpt-5.2-codex'],
      'openai-codex',
    );
    expect(getMiniModel(conn)).toBe('pi/gpt-5.2-codex');
  });
});

// ============================================================
// isDeniedMiniModelId — re-exported from this module so getMiniModel and
// the pi-agent-server queryLlm guard share one source of truth.
// ============================================================

describe('isDeniedMiniModelId()', () => {
  it('always denies codex-mini-latest', () => {
    expect(isDeniedMiniModelId('codex-mini-latest')).toBe(true);
    expect(isDeniedMiniModelId('pi/codex-mini-latest')).toBe(true);
    expect(isDeniedMiniModelId('codex-mini-latest', 'openai')).toBe(true);
  });

  it('denies *codex-mini* variants only under openai-codex auth', () => {
    expect(isDeniedMiniModelId('gpt-5.1-codex-mini', 'openai-codex')).toBe(true);
    expect(isDeniedMiniModelId('pi/gpt-5.1-codex-mini', 'openai-codex')).toBe(true);
    expect(isDeniedMiniModelId('gpt-5.1-codex-mini', 'openai')).toBe(false);
    expect(isDeniedMiniModelId('gpt-5.1-codex-mini')).toBe(false);
  });

  it('does not deny non-codex-mini models', () => {
    expect(isDeniedMiniModelId('gpt-5-mini', 'openai-codex')).toBe(false);
    expect(isDeniedMiniModelId('claude-haiku-4-5', 'openai-codex')).toBe(false);
    expect(isDeniedMiniModelId('gpt-5.1-codex', 'openai-codex')).toBe(false);
  });
});

describe('AnyRouter platform profiles', () => {
  it('normalizes clean HTTPS endpoints for both AnyRouter profiles', () => {
    expect(normalizePlatformProfileBaseUrl('anyrouter', 'https://anyrouter.top/')).toBe('https://anyrouter.top');
    expect(normalizePlatformProfileBaseUrl('anyrouter_pi', 'https://overseas.example.test/'))
      .toBe('https://overseas.example.test');
  });

  it('rejects unsafe or non-root AnyRouter-Pi endpoints', () => {
    expect(() => normalizePlatformProfileBaseUrl('anyrouter_pi', 'http://anyrouter.top'))
      .toThrow('requires a valid HTTPS endpoint');
    expect(() => normalizePlatformProfileBaseUrl('anyrouter_pi', 'https://user:pass@anyrouter.top'))
      .toThrow('requires a valid HTTPS endpoint');
    expect(() => normalizePlatformProfileBaseUrl('anyrouter_pi', 'https://anyrouter.top/v1'))
      .toThrow('requires a valid HTTPS endpoint');
  });
});

describe('normalizeCustomEndpointUrl()', () => {
  const cases: Array<{
    name: string;
    api: CustomEndpointApi;
    input: string;
    modelId?: string;
    expected: { baseUrl: string; requestPreviewUrl: string };
  }> = [
    {
      name: 'normalizes OpenAI Chat origin, v1, and full request URL to one endpoint',
      api: 'openai-completions',
      input: 'api.example.test',
      expected: {
        baseUrl: 'https://api.example.test/v1',
        requestPreviewUrl: 'https://api.example.test/v1/chat/completions',
      },
    },
    {
      name: 'normalizes OpenAI Chat v1 URL',
      api: 'openai-completions',
      input: 'http://api.example.test/v1/',
      expected: {
        baseUrl: 'http://api.example.test/v1',
        requestPreviewUrl: 'http://api.example.test/v1/chat/completions',
      },
    },
    {
      name: 'strips an OpenAI Chat full request URL once',
      api: 'openai-completions',
      input: 'https://api.example.test/v1/chat/completions/',
      expected: {
        baseUrl: 'https://api.example.test/v1',
        requestPreviewUrl: 'https://api.example.test/v1/chat/completions',
      },
    },
    {
      name: 'keeps an OpenAI custom prefix while stripping its known operation path',
      api: 'openai-completions',
      input: 'https://gateway.example.test/tenant/openai/chat/completions',
      expected: {
        baseUrl: 'https://gateway.example.test/tenant/openai',
        requestPreviewUrl: 'https://gateway.example.test/tenant/openai/chat/completions',
      },
    },
    {
      name: 'normalizes OpenAI Responses full request URL',
      api: 'openai-responses',
      input: 'https://api.example.test/v1/responses',
      expected: {
        baseUrl: 'https://api.example.test/v1',
        requestPreviewUrl: 'https://api.example.test/v1/responses',
      },
    },
    {
      name: 'switches a full Chat request URL to Responses without retaining the old operation',
      api: 'openai-responses',
      input: 'https://api.example.test/v1/chat/completions',
      expected: {
        baseUrl: 'https://api.example.test/v1',
        requestPreviewUrl: 'https://api.example.test/v1/responses',
      },
    },
    {
      name: 'normalizes Anthropic full messages URL without duplication',
      api: 'anthropic-messages',
      input: 'https://api.example.test/v1/messages',
      expected: {
        baseUrl: 'https://api.example.test',
        requestPreviewUrl: 'https://api.example.test/v1/messages',
      },
    },
    {
      name: 'normalizes Anthropic v1 URL and preserves a custom prefix',
      api: 'anthropic-messages',
      input: 'https://gateway.example.test/tenant/v1',
      expected: {
        baseUrl: 'https://gateway.example.test/tenant',
        requestPreviewUrl: 'https://gateway.example.test/tenant/v1/messages',
      },
    },
    {
      name: 'normalizes Gemini full stream URL to the SDK API-version base',
      api: 'google-generative-ai',
      input: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent',
      modelId: 'models/gemini 2.5 flash',
      expected: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        requestPreviewUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini%202.5%20flash:streamGenerateContent?alt=sse',
      },
    },
    {
      name: 'normalizes the official non-streaming Gemini URL while keeping the Pi streaming preview',
      api: 'google-generative-ai',
      input: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
      modelId: 'gemini-3.6-flash',
      expected: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        requestPreviewUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse',
      },
    },
    {
      name: 'adds Gemini SDK path beneath a custom prefix',
      api: 'google-generative-ai',
      input: 'https://gateway.example.test/tenant/',
      modelId: 'gemini-2.5-flash',
      expected: {
        baseUrl: 'https://gateway.example.test/tenant/v1beta',
        requestPreviewUrl: 'https://gateway.example.test/tenant/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      },
    },
    {
      name: 'switches an OpenAI v1 request URL to Gemini without retaining the old operation',
      api: 'google-generative-ai',
      input: 'https://gateway.example.test/tenant/v1/chat/completions',
      modelId: 'gemini-2.5-flash',
      expected: {
        baseUrl: 'https://gateway.example.test/tenant/v1beta',
        requestPreviewUrl: 'https://gateway.example.test/tenant/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      },
    },
    {
      name: 'strips a Gemini operation path below a custom prefix only',
      api: 'google-generative-ai',
      input: 'https://gateway.example.test/tenant/models/gemini-2.5-flash:streamGenerateContent',
      modelId: 'gemini-2.5-flash',
      expected: {
        baseUrl: 'https://gateway.example.test/tenant/v1beta',
        requestPreviewUrl: 'https://gateway.example.test/tenant/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      },
    },
    {
      name: 'adds Gemini SDK path to a root endpoint without duplicate slashes',
      api: 'google-generative-ai',
      input: 'https://generativelanguage.googleapis.com/',
      modelId: 'gemini-2.5-flash',
      expected: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        requestPreviewUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      },
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(normalizeCustomEndpointUrl(testCase.api, testCase.input, testCase.modelId))
        .toEqual(testCase.expected);
    });
  }

  const invalidInputs = [
    'ftp://api.example.test',
    'https://user:pass@api.example.test',
    'https://api.example.test/v1?api_key=secret',
    'https://api.example.test/v1#fragment',
  ];

  for (const input of invalidInputs) {
    it(`rejects an unsafe endpoint URL: ${input}`, () => {
      expect(() => normalizeCustomEndpointUrl('openai-completions', input))
        .toThrow('requires a valid HTTP(S) URL');
    });
  }

  it('rejects unsupported protocol values at runtime', () => {
    expect(() => normalizeCustomEndpointUrl('unsupported' as CustomEndpointApi, 'https://api.example.test'))
      .toThrow('Unsupported custom endpoint API');
  });

  it('preserves a validated custom Base URL without deriving a protocol path', () => {
    expect(normalizeCustomEndpointUrl(
      'openai-completions',
      'https://gateway.example.test/tenant/full-request/',
      undefined,
      true,
    )).toEqual({
      baseUrl: 'https://gateway.example.test/tenant/full-request/',
      requestPreviewUrl: 'https://gateway.example.test/tenant/full-request/',
    });
  });
});

describe('getPiAuthProviderForCustomEndpointApi()', () => {
  const cases: Array<[CustomEndpointApi, 'openai' | 'anthropic' | 'google']> = [
    ['openai-completions', 'openai'],
    ['openai-responses', 'openai'],
    ['anthropic-messages', 'anthropic'],
    ['google-generative-ai', 'google'],
  ];

  for (const [api, provider] of cases) {
    it(`maps ${api} to ${provider}`, () => {
      expect(getPiAuthProviderForCustomEndpointApi(api)).toBe(provider);
    });
  }
});

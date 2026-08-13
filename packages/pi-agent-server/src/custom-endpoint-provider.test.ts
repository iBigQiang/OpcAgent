import { describe, expect, it } from 'bun:test';
import {
  AuthStorage as PiAuthStorage,
  ModelRegistry as PiModelRegistry,
} from '@earendil-works/pi-coding-agent';
import {
  isCompatibleCustomEndpointModelProvider,
  resolveCustomEndpointAuthProvider,
  resolveCustomEndpointCredentialProviders,
  resolveCustomEndpointProviderId,
} from './custom-endpoint-provider.ts';

describe('custom endpoint provider routing', () => {
  it('uses AgentRouter as the provider for initial and runtime Pi model resolution', () => {
    expect(resolveCustomEndpointProviderId('agentrouter')).toBe('agentrouter');
    expect(resolveCustomEndpointAuthProvider('agentrouter', 'openai')).toBe('agentrouter');
    expect(resolveCustomEndpointCredentialProviders('agentrouter', 'openai'))
      .toEqual(['openai', 'agentrouter']);
    expect(isCompatibleCustomEndpointModelProvider('agentrouter', 'agentrouter', 'agentrouter')).toBe(true);
    expect(isCompatibleCustomEndpointModelProvider('anthropic', 'agentrouter', 'agentrouter')).toBe(false);
  });

  it('resolves the initial AgentRouter model credential from auth storage', async () => {
    const authStorage = PiAuthStorage.inMemory();
    for (const provider of resolveCustomEndpointCredentialProviders('agentrouter', 'openai')) {
      authStorage.set(provider, { type: 'api_key', key: 'test-agentrouter-token' });
    }
    const modelRegistry = PiModelRegistry.inMemory(authStorage);
    modelRegistry.registerProvider(resolveCustomEndpointProviderId('agentrouter'), {
      baseUrl: 'https://agentrouter.org/v1',
      apiKey: 'test-agentrouter-token',
      api: 'openai-completions',
      authHeader: true,
      models: [{
        id: 'claude-opus-5',
        name: 'claude-opus-5',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131_072,
        maxTokens: 8_192,
      }],
    });

    const model = modelRegistry.find('agentrouter', 'claude-opus-5');
    expect(model?.provider).toBe('agentrouter');
    await expect(modelRegistry.getApiKeyAndHeaders(model!)).resolves.toMatchObject({
      ok: true,
      apiKey: 'test-agentrouter-token',
      headers: { Authorization: 'Bearer test-agentrouter-token' },
    });
  });

  it('keeps Generic Custom on the synthetic provider', () => {
    expect(resolveCustomEndpointProviderId()).toBe('custom-endpoint');
    expect(resolveCustomEndpointAuthProvider(undefined, 'anthropic')).toBe('anthropic');
    expect(resolveCustomEndpointCredentialProviders(undefined, 'anthropic')).toEqual(['anthropic']);
    expect(isCompatibleCustomEndpointModelProvider('custom-endpoint', 'anthropic')).toBe(true);
  });

  it('does not apply the AgentRouter alias to AnyRouter-Pi', () => {
    expect(resolveCustomEndpointProviderId('anyrouter_pi')).toBe('custom-endpoint');
    expect(resolveCustomEndpointAuthProvider('anyrouter_pi', 'anthropic')).toBe('anthropic');
    expect(resolveCustomEndpointCredentialProviders('anyrouter_pi', 'anthropic')).toEqual(['anthropic']);
  });
});

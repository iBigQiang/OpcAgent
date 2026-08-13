import { describe, expect, it } from 'bun:test';
import {
  BACKEND_CAPABILITIES,
  connectionAuthTypeToBackendAuthType,
  createBackend,
  detectProvider,
  getAvailableProviders,
  getDefaultAuthType,
  isProviderAvailable,
  providerTypeToAgentProvider,
  resolveModelForProvider,
  resolveSetupTestConnectionHint,
} from '../factory.ts';
import { createMockBackendConfig } from '../../__tests__/test-utils.ts';
import { normalizeAnyRouterBaseUrl } from '../internal/drivers/anthropic.ts';

describe('backend registry', () => {
  it('registers Claude CLI and Pi', () => {
    expect(getAvailableProviders()).toEqual(['anthropic', 'pi']);
    expect(isProviderAvailable('anthropic')).toBe(true);
    expect(isProviderAvailable('pi')).toBe(true);
  });

  it('routes every retained provider preset through Pi', () => {
    expect(detectProvider('api_key')).toBe('pi');
    expect(providerTypeToAgentProvider('pi_compat')).toBe('pi');
    expect(providerTypeToAgentProvider('pi')).toBe('pi');
  });

  it('detects Pi for endpoint API keys', () => {
    expect(detectProvider('api_key_with_endpoint')).toBe('pi');
  });

  it('rejects an unregistered backend', () => {
    expect(() => createBackend({ ...createMockBackendConfig(), provider: 'unknown' as 'pi' }))
      .toThrow('Unknown provider');
  });

  it('reports unknown providers unavailable', () => {
    expect(isProviderAvailable('unknown' as 'pi')).toBe(false);
  });

  it('maps retained provider types to Pi', () => {
    expect(providerTypeToAgentProvider('pi')).toBe('pi');
    expect(providerTypeToAgentProvider('pi_compat')).toBe('pi');
  });

  it('routes only the AnyRouter profile through the Claude CLI backend', () => {
    expect(providerTypeToAgentProvider('pi_compat', 'anyrouter')).toBe('anthropic');
    expect(providerTypeToAgentProvider('pi_compat', 'anyrouter_pi')).toBe('pi');
    expect(providerTypeToAgentProvider('pi_compat', 'agentrouter')).toBe('pi');
  });

  it('accepts a clean HTTPS endpoint for the AnyRouter profile', () => {
    expect(normalizeAnyRouterBaseUrl('https://anyrouter.top/')).toBe('https://anyrouter.top');
    expect(normalizeAnyRouterBaseUrl('https://overseas.example.test/')).toBe('https://overseas.example.test');
    expect(() => normalizeAnyRouterBaseUrl('http://anyrouter.top')).toThrow('requires a valid HTTPS endpoint');
    expect(() => normalizeAnyRouterBaseUrl('https://anyrouter.top/v1')).toThrow('requires a valid HTTPS endpoint');
    expect(normalizeAnyRouterBaseUrl('https://anyrouter.top:444')).toBe('https://anyrouter.top:444');
  });

  it('passes through retained API key auth types', () => {
    expect(connectionAuthTypeToBackendAuthType('api_key')).toBe('api_key');
    expect(connectionAuthTypeToBackendAuthType('api_key_with_endpoint')).toBe('api_key_with_endpoint');
  });

  it('passes OAuth through to the Pi backend', () => {
    expect(connectionAuthTypeToBackendAuthType('oauth')).toBe('oauth');
    expect(detectProvider('oauth')).toBe('pi');
  });

  it('maps no-auth connections to undefined credentials', () => {
    expect(connectionAuthTypeToBackendAuthType('none')).toBeUndefined();
  });

  it('uses API key auth by default', () => {
    expect(getDefaultAuthType('pi')).toBe('api_key');
  });

  it('declares no HTTP pool requirement for Pi', () => {
    expect(BACKEND_CAPABILITIES.pi.needsHttpPoolServer).toBe(false);
  });

  it('maps custom endpoints to Pi compatibility connections', () => {
    expect(resolveSetupTestConnectionHint({
      provider: 'pi',
      baseUrl: 'https://example.test',
      customEndpoint: { api: 'openai-completions' },
    })).toEqual({
      providerType: 'pi_compat',
      piAuthProvider: 'openai',
      customEndpoint: { api: 'openai-completions' },
    });
  });

  it('maps custom Responses and Gemini endpoints to their Pi credential providers', () => {
    expect(resolveSetupTestConnectionHint({
      provider: 'pi',
      baseUrl: 'https://example.test/v1',
      customEndpoint: { api: 'openai-responses' },
    })).toMatchObject({ providerType: 'pi_compat', piAuthProvider: 'openai' });

    expect(resolveSetupTestConnectionHint({
      provider: 'pi',
      baseUrl: 'https://example.test/v1beta/models',
      customEndpoint: { api: 'google-generative-ai' },
    })).toMatchObject({ providerType: 'pi_compat', piAuthProvider: 'google' });
  });

  it('preserves a platform profile for custom endpoint setup tests', () => {
    expect(resolveSetupTestConnectionHint({
      provider: 'pi',
      baseUrl: 'https://anyrouter.top',
      customEndpoint: { api: 'anthropic-messages' },
      platformProfile: 'anyrouter',
    })).toEqual({
      providerType: 'pi_compat',
      piAuthProvider: 'anthropic',
      customEndpoint: { api: 'anthropic-messages' },
      platformProfile: 'anyrouter',
    });
  });

  it('preserves Pi auth provider hints', () => {
    expect(resolveSetupTestConnectionHint({ provider: 'pi', piAuthProvider: 'deepseek' }))
      .toEqual({ providerType: 'pi', piAuthProvider: 'deepseek' });
  });

  it('uses a retained managed model', () => {
    expect(resolveModelForProvider('pi', 'model-b', {
      slug: 'test', name: 'Test', providerType: 'pi', authType: 'api_key',
      defaultModel: 'model-a', models: ['model-a', 'model-b'], createdAt: 1,
    })).toBe('model-b');
  });

  it('falls back when a managed model is not in the connection list', () => {
    expect(resolveModelForProvider('pi', 'stale-model', {
      slug: 'test', name: 'Test', providerType: 'pi', authType: 'api_key',
      defaultModel: 'model-a', models: ['model-a', 'model-b'], createdAt: 1,
    })).toBe('model-a');
  });

  it('falls back to the first model for a stale connection default', () => {
    expect(resolveModelForProvider('pi', undefined, {
      slug: 'test', name: 'Test', providerType: 'pi', authType: 'api_key',
      defaultModel: 'stale-model', models: ['model-a', 'model-b'], createdAt: 1,
    })).toBe('model-a');
  });
});

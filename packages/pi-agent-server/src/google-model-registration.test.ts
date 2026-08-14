import { describe, expect, it } from 'bun:test';
import {
  AuthStorage as PiAuthStorage,
  ModelRegistry as PiModelRegistry,
} from '@earendil-works/pi-coding-agent';
import { clampThinkingLevel } from '@earendil-works/pi-ai';
import { registerGoogleModelCatalog } from './google-model-registration.ts';

describe('Google model catalog compatibility registration', () => {
  it('adds current stable Flash models without dropping Pi built-ins', () => {
    const authStorage = PiAuthStorage.inMemory();
    authStorage.set('google', { type: 'api_key', key: 'test-google-token' });
    const registry = PiModelRegistry.inMemory(authStorage);

    registerGoogleModelCatalog(registry, 'test-google-token');

    expect(registry.find('google', 'gemini-2.5-flash')).toBeDefined();
    expect(registry.find('google', 'gemini-3.5-flash-lite')).toBeDefined();
    expect(registry.find('google', 'gemini-3.6-flash')).toBeDefined();
    expect(registry.find('google', 'gemini-3.7-flash')).toMatchObject({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      api: 'google-generative-ai',
      reasoning: true,
      contextWindow: 1_048_576,
      maxTokens: 65_536,
    });
  });

  it('maps unsupported Gemini 3.7 minimal effort to a supported level', () => {
    const authStorage = PiAuthStorage.inMemory();
    const registry = PiModelRegistry.inMemory(authStorage);

    registerGoogleModelCatalog(registry, 'test-google-token');

    const model = registry.find('google', 'gemini-3.7-flash')!;
    expect(model.thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: 'LOW',
      medium: 'MEDIUM',
      high: 'HIGH',
      xhigh: 'HIGH',
      max: 'HIGH',
    });
    expect(clampThinkingLevel(model, 'off')).toBe('low');
    expect(clampThinkingLevel(model, 'minimal')).toBe('low');
  });
});

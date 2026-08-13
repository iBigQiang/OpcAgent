import { afterEach, describe, expect, it } from 'bun:test';
import { setInterceptorApiHints } from './interceptor-api-hints.ts';

const hintVariables = [
  'OPCAGENT_PI_MODEL_API',
  'OPCAGENT_PI_MODEL_PROVIDER',
  'OPCAGENT_PI_MODEL_BASE_URL',
  'OPCAGENT_PLATFORM_PROFILE',
] as const;

const originalEnvironment = Object.fromEntries(
  hintVariables.map(name => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of hintVariables) {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('setInterceptorApiHints', () => {
  const model = {
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: 'https://agentrouter.org',
  };

  it('clears the AnyRouter-Pi profile when switching to AgentRouter or no profile', () => {
    setInterceptorApiHints(model, 'anyrouter_pi');
    expect(process.env.OPCAGENT_PLATFORM_PROFILE).toBe('anyrouter_pi');

    setInterceptorApiHints(model, 'agentrouter');
    expect(process.env.OPCAGENT_PLATFORM_PROFILE).toBe('agentrouter');

    setInterceptorApiHints(model, undefined);
    expect(process.env.OPCAGENT_PLATFORM_PROFILE).toBeUndefined();
  });

  it('clears every interceptor hint when no Pi model is active', () => {
    setInterceptorApiHints(model, 'anyrouter_pi');
    setInterceptorApiHints(undefined);

    for (const name of hintVariables) {
      expect(process.env[name]).toBeUndefined();
    }
  });
});

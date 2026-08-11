import { describe, expect, it } from 'bun:test'
import { apiSetupMethodToConnectionSetup, BASE_SLUG_FOR_METHOD, resolveSlugForMethod } from '../useOnboarding'

describe('Pi-only connection setup', () => {
  it('uses the Pi base slug', () => {
    expect(resolveSlugForMethod('pi_api_key', null, new Set())).toBe('pi-api-key')
  })

  it('exposes only Claude, ChatGPT, and API key setup methods', () => {
    expect(BASE_SLUG_FOR_METHOD).toEqual({
      claude_oauth: 'claude-max',
      pi_chatgpt_oauth: 'chatgpt-plus',
      pi_api_key: 'pi-api-key',
    })
  })

  it('generates a unique slug for a new connection', () => {
    expect(resolveSlugForMethod('pi_api_key', null, new Set(['pi-api-key']))).toBe('pi-api-key-2')
  })

  it('reuses the slug while editing', () => {
    expect(resolveSlugForMethod('pi_api_key', 'existing', new Set(['pi-api-key']))).toBe('existing')
  })

  it('preserves Pi provider, endpoint, model, and credential settings', () => {
    const setup = apiSetupMethodToConnectionSetup(
      'pi_api_key',
      {
        credential: 'sk-test',
        baseUrl: 'https://example.test/v1',
        connectionDefaultModel: 'model-a',
        models: ['model-a'],
        piAuthProvider: 'openai',
        modelSelectionMode: 'userDefined3Tier',
      },
      null,
      new Set(),
    )

    expect(setup).toMatchObject({
      slug: 'pi-api-key',
      credential: 'sk-test',
      baseUrl: 'https://example.test/v1',
      defaultModel: 'model-a',
      models: ['model-a'],
      piAuthProvider: 'openai',
      modelSelectionMode: 'userDefined3Tier',
    })
  })

  it('preserves a branded platform profile in API-key connection setup', () => {
    const setup = apiSetupMethodToConnectionSetup(
      'pi_api_key',
      {
        baseUrl: 'https://agentrouter.org',
        connectionDefaultModel: 'claude-opus-5',
        models: ['claude-opus-5', 'claude-opus-4-8'],
        piAuthProvider: 'anthropic',
        customEndpoint: { api: 'anthropic-messages' },
        platformProfile: 'agentrouter',
      },
      null,
      new Set(),
    )

    expect(setup).toMatchObject({
      customEndpoint: { api: 'anthropic-messages' },
      platformProfile: 'agentrouter',
    })
  })

  it('preserves the AnyRouter-Pi profile when saving its experimental endpoint', () => {
    const setup = apiSetupMethodToConnectionSetup(
      'pi_api_key',
      {
        baseUrl: 'https://anyrouter.top',
        connectionDefaultModel: 'claude-opus-5[1m]',
        models: ['claude-opus-5[1m]', 'claude-fable-5[1m]', 'claude-opus-4-8[1m]'],
        piAuthProvider: 'anthropic',
        customEndpoint: { api: 'anthropic-messages' },
        platformProfile: 'anyrouter_pi',
      },
      'existing-anyrouter-pi',
      new Set(),
    )

    expect(setup).toMatchObject({
      slug: 'existing-anyrouter-pi',
      baseUrl: 'https://anyrouter.top',
      customEndpoint: { api: 'anthropic-messages' },
      platformProfile: 'anyrouter_pi',
    })
  })

  it('maps Claude OAuth identity to the Claude Max subscription connection', () => {
    const setup = apiSetupMethodToConnectionSetup(
      'claude_oauth',
      {
        oauthIdentity: {
          account: { uuid: 'account-1', emailAddress: 'user@example.test' },
          organization: { uuid: 'org-1', name: 'Example' },
        },
      },
      null,
      new Set(),
    )

    expect(setup).toEqual({
      slug: 'claude-max',
      credential: undefined,
      oauthIdentity: {
        account: { uuid: 'account-1', emailAddress: 'user@example.test' },
        organization: { uuid: 'org-1', name: 'Example' },
      },
    })
  })

  it('maps ChatGPT OAuth to a unique ChatGPT Plus slug', () => {
    expect(apiSetupMethodToConnectionSetup(
      'pi_chatgpt_oauth',
      {},
      null,
      new Set(['chatgpt-plus']),
    )).toEqual({ slug: 'chatgpt-plus-2', credential: undefined })
  })
})

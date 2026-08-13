import { describe, expect, it } from 'bun:test'
import { createConnection } from './llm-connections'

describe('createConnection custom endpoint normalization', () => {
  it('normalizes AgentRouter full OpenAI request URLs before persistence', () => {
    const connection = createConnection({
      slug: 'agentrouter',
      credential: 'test-key',
      baseUrl: 'https://agentrouter.org/v1/chat/completions',
      defaultModel: 'gpt-5.6-sol',
      models: ['gpt-5.6-sol'],
      customEndpoint: { api: 'openai-completions' },
      platformProfile: 'agentrouter',
    })

    expect(connection).toMatchObject({
      baseUrl: 'https://agentrouter.org/v1',
      piAuthProvider: 'openai',
      customEndpoint: { api: 'openai-completions' },
      platformProfile: 'agentrouter',
    })
  })

  it('normalizes Gemini full request URLs to the SDK models base', () => {
    const connection = createConnection({
      slug: 'custom-gemini',
      credential: 'test-key',
      baseUrl: 'https://gateway.example.test/v1beta/models/gemini-2.5-pro:streamGenerateContent',
      defaultModel: 'gemini-2.5-pro',
      models: ['gemini-2.5-pro'],
      customEndpoint: { api: 'google-generative-ai' },
    })

    expect(connection).toMatchObject({
      baseUrl: 'https://gateway.example.test/v1beta/models',
      piAuthProvider: 'google',
      customEndpoint: { api: 'google-generative-ai' },
    })
  })

  it.each(['anyrouter', 'anyrouter_pi'] as const)(
    'pins the %s profile to Anthropic Messages at the server boundary',
    platformProfile => {
      const connection = createConnection({
        slug: `${platformProfile}-connection`,
        credential: 'test-key',
        baseUrl: 'https://anyrouter.top',
        defaultModel: 'claude-opus-5[1m]',
        models: ['claude-opus-5[1m]'],
        customEndpoint: { api: 'openai-responses' },
        platformProfile,
      })

      expect(connection).toMatchObject({
        baseUrl: 'https://anyrouter.top',
        piAuthProvider: 'anthropic',
        customEndpoint: { api: 'anthropic-messages' },
        platformProfile,
      })
    },
  )

  it('keeps AnyRouter profile endpoints restricted to a clean HTTPS origin', () => {
    expect(() => createConnection({
      slug: 'anyrouter-unsafe-path',
      credential: 'test-key',
      baseUrl: 'https://anyrouter.top/v1',
      defaultModel: 'claude-opus-5[1m]',
      models: ['claude-opus-5[1m]'],
      customEndpoint: { api: 'anthropic-messages' },
      platformProfile: 'anyrouter_pi',
    })).toThrow('anyrouter_pi profile requires a valid HTTPS endpoint')
  })

  it('rejects unsafe endpoint URLs before persistence', () => {
    expect(() => createConnection({
      slug: 'unsafe-endpoint',
      baseUrl: 'https://user:pass@example.test/v1',
      defaultModel: 'model',
      models: ['model'],
      customEndpoint: { api: 'openai-completions' },
    })).toThrow('requires a valid HTTP(S) URL')
  })
})

import { describe, expect, it } from 'bun:test'
import {
  resolveCustomEndpointPayload,
  resolveEditableApiKey,
  resolvePiAuthProviderForSubmit,
  resolvePresetStateForBaseUrlChange,
} from '../submit-helpers'

describe('resolveEditableApiKey', () => {
  it('never hydrates a masked credential hint into the editable key field', () => {
    expect(resolveEditableApiKey('sk-test••••tail')).toBe('')
    expect(resolveEditableApiKey('sk-test-raw')).toBe('sk-test-raw')
  })
})
import { pickTierDefaults, resolveTierModels } from '../tier-models'

const MODELS = [
  { id: 'pi/zai-best', name: 'Best', costInput: 10, costOutput: 20, contextWindow: 200000, reasoning: true },
  { id: 'pi/zai-balanced', name: 'Balanced', costInput: 5, costOutput: 10, contextWindow: 200000, reasoning: true },
  { id: 'pi/zai-fast', name: 'Fast', costInput: 1, costOutput: 2, contextWindow: 128000, reasoning: false },
]

describe('ApiKeyInput tier hydration helpers', () => {
  it('resolveTierModels keeps saved tier selections when all are valid', () => {
    const saved = ['pi/zai-fast', 'pi/zai-balanced', 'pi/zai-best']
    const resolved = resolveTierModels(MODELS, saved)

    expect(resolved).toEqual({
      best: 'pi/zai-fast',
      default_: 'pi/zai-balanced',
      cheap: 'pi/zai-best',
    })
  })

  it('resolveTierModels preserves duplicate tiers when saved models are valid', () => {
    const saved = ['pi/zai-best', 'pi/zai-best', 'pi/zai-fast']
    const resolved = resolveTierModels(MODELS, saved)

    expect(resolved).toEqual({
      best: 'pi/zai-best',
      default_: 'pi/zai-best',
      cheap: 'pi/zai-fast',
    })
  })

  it('resolveTierModels falls back per-slot for invalid/missing saved values', () => {
    const resolved = resolveTierModels(MODELS, ['pi/zai-best', 'pi/not-real'])
    const defaults = pickTierDefaults(MODELS)

    expect(resolved).toEqual({
      best: 'pi/zai-best',
      default_: defaults.default_,
      cheap: defaults.cheap,
    })
  })
})

describe('resolvePiAuthProviderForSubmit', () => {
  it('preserves the last non-custom provider when custom endpoint mode is selected', () => {
    expect(resolvePiAuthProviderForSubmit('custom', 'openai')).toBe('openai')
  })

  it('defaults custom endpoint mode to anthropic routing when none was selected yet', () => {
    expect(resolvePiAuthProviderForSubmit('custom', null)).toBe('anthropic')
  })

  it('passes through non-custom presets unchanged', () => {
    expect(resolvePiAuthProviderForSubmit('google', 'anthropic')).toBe('google')
  })
})

describe('resolvePresetStateForBaseUrlChange', () => {
  it('updates the remembered provider when the typed URL matches a known preset', () => {
    expect(resolvePresetStateForBaseUrlChange({
      matchedPreset: 'openrouter',
      activePreset: 'custom',
      activePresetHasEmptyUrl: true,
      lastNonCustomPreset: 'anthropic',
    })).toEqual({
      activePreset: 'openrouter',
      lastNonCustomPreset: 'openrouter',
    })
  })

  it('preserves provider routing when editing a provider with an empty default URL', () => {
    expect(resolvePresetStateForBaseUrlChange({
      matchedPreset: 'custom',
      activePreset: 'azure-openai-responses',
      activePresetHasEmptyUrl: true,
      lastNonCustomPreset: 'azure-openai-responses',
    })).toEqual({
      activePreset: 'azure-openai-responses',
      lastNonCustomPreset: 'azure-openai-responses',
    })
  })

  it('falls back to custom while keeping the most recent matched provider', () => {
    expect(resolvePresetStateForBaseUrlChange({
      matchedPreset: 'custom',
      activePreset: 'openrouter',
      activePresetHasEmptyUrl: false,
      lastNonCustomPreset: 'openrouter',
    })).toEqual({
      activePreset: 'custom',
      lastNonCustomPreset: 'openrouter',
    })
  })
})

describe('resolveCustomEndpointPayload', () => {
  const BRANDED = new Set(['manifest'])

  it('routes branded openai-compat presets through openai-completions regardless of toggle', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'manifest',
      baseUrl: 'https://app.manifest.build/v1',
      customApi: 'anthropic-messages',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'openai-completions' },
      piAuthProvider: 'openai',
    })
  })

  it('honors the protocol toggle for the generic custom preset', () => {
    const payload = resolveCustomEndpointPayload({
      activePreset: 'custom',
      baseUrl: 'https://my-endpoint.example.com',
      customApi: 'anthropic-messages',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })

    expect(payload).toEqual({
      customEndpoint: { api: 'anthropic-messages' },
      piAuthProvider: 'anthropic',
    })
    expect(payload).not.toHaveProperty('platformProfile')
  })

  it('returns no customEndpoint for a standard preset, passing through the fallback piAuth', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: 'openrouter',
    })).toEqual({
      customEndpoint: undefined,
      piAuthProvider: 'openrouter',
    })
  })

  it('treats branded preset with empty URL as non-custom (no customEndpoint)', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'manifest',
      baseUrl: '',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: undefined,
      piAuthProvider: undefined,
    })
  })

  it('defaults AgentRouter to OpenAI Chat and persists its platform profile', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'agentrouter',
      baseUrl: 'https://agentrouter.org',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'openai-completions' },
      piAuthProvider: 'openai',
      platformProfile: 'agentrouter',
    })
  })

  it('allows AgentRouter to use each supported editable protocol', () => {
    const cases = [
      ['openai-responses', 'openai'],
      ['anthropic-messages', 'anthropic'],
      ['google-generative-ai', 'google'],
    ] as const

    for (const [customApi, piAuthProvider] of cases) {
      expect(resolveCustomEndpointPayload({
        activePreset: 'agentrouter',
        baseUrl: 'https://agentrouter.org/v1',
        customApi,
        brandedOpenAiCompatPresets: BRANDED,
        fallbackPiAuthProvider: undefined,
      })).toEqual({
        customEndpoint: { api: customApi },
        piAuthProvider,
        platformProfile: 'agentrouter',
      })
    }
  })

  it('persists the custom Base URL mode without changing AgentRouter routing', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'agentrouter',
      baseUrl: 'https://agentrouter.org/v1',
      customApi: 'openai-completions',
      preserveCustomBaseUrl: true,
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'openai-completions', urlNormalization: 'preserve' },
      piAuthProvider: 'openai',
      platformProfile: 'agentrouter',
    })
  })

  it('does not leak custom Base URL mode into other provider presets', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'manifest',
      baseUrl: 'https://app.manifest.build/v1',
      customApi: 'openai-completions',
      preserveCustomBaseUrl: true,
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'openai-completions' },
      piAuthProvider: 'openai',
    })

    expect(resolveCustomEndpointPayload({
      activePreset: 'anyrouter',
      baseUrl: 'https://anyrouter.top',
      customApi: 'openai-completions',
      preserveCustomBaseUrl: true,
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'anthropic-messages' },
      piAuthProvider: 'anthropic',
      platformProfile: 'anyrouter',
    })
  })

  it('pins AnyRouter to Anthropic Messages and persists its platform profile', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'anyrouter',
      baseUrl: 'https://anyrouter.top',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'anthropic-messages' },
      piAuthProvider: 'anthropic',
      platformProfile: 'anyrouter',
    })
  })

  it('pins the experimental AnyRouter-Pi preset to Anthropic Messages', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'anyrouter_pi',
      baseUrl: 'https://anyrouter.top',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'anthropic-messages' },
      piAuthProvider: 'anthropic',
      platformProfile: 'anyrouter_pi',
    })
  })

  it('keeps a branded platform profile selected while its endpoint is edited', () => {
    expect(resolvePresetStateForBaseUrlChange({
      matchedPreset: 'custom',
      activePreset: 'anyrouter_pi',
      activePresetHasEmptyUrl: false,
      preserveActivePreset: true,
      lastNonCustomPreset: 'anyrouter_pi',
    })).toEqual({
      activePreset: 'anyrouter_pi',
      lastNonCustomPreset: 'anyrouter_pi',
    })
  })

  it('does not switch a branded platform profile when its endpoint matches another preset', () => {
    expect(resolvePresetStateForBaseUrlChange({
      matchedPreset: 'openrouter',
      activePreset: 'agentrouter',
      activePresetHasEmptyUrl: false,
      preserveActivePreset: true,
      lastNonCustomPreset: 'agentrouter',
    })).toEqual({
      activePreset: 'agentrouter',
      lastNonCustomPreset: 'agentrouter',
    })
  })
})

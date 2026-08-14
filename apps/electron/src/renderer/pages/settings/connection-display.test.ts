import { describe, expect, it } from 'bun:test'
import { getEndpointProtocolLabel, getPlatformConnectionDescription } from './connection-display'

describe('getPlatformConnectionDescription', () => {
  const translations: Record<string, string> = {
    'settings.ai.platform.anyrouter': 'AnyRouter-CC · Claude Code CLI',
    'settings.ai.platform.anyrouterPi': 'AnyRouter-Pi',
    'settings.ai.platform.agentrouter': 'AgentRouter · Pi Backend Compatible',
  }
  const t = (key: string) => translations[key] ?? key

  it('shows AnyRouter-CC as the Claude Code CLI runtime', () => {
    expect(getPlatformConnectionDescription('anyrouter', t)).toBe('AnyRouter-CC · Claude Code CLI')
  })

  it('shows the concise AnyRouter-Pi label', () => {
    expect(getPlatformConnectionDescription('anyrouter_pi', t)).toBe('AnyRouter-Pi')
  })

  it('shows AgentRouter as the Pi-compatible runtime', () => {
    expect(getPlatformConnectionDescription('agentrouter', t)).toBe('AgentRouter · Pi Backend Compatible')
  })

  it('does not replace generic endpoint descriptions', () => {
    expect(getPlatformConnectionDescription(undefined, t)).toBeUndefined()
  })
})

describe('getEndpointProtocolLabel', () => {
  const translations: Record<string, string> = {
    'apiSetup.protocol.openAiChat': 'OpenAI Chat Completions',
    'apiSetup.protocol.openAiResponses': 'OpenAI Responses',
    'apiSetup.protocol.anthropicMessages': 'Anthropic Messages',
    'apiSetup.protocol.customBaseUrl': 'Custom Base URL (no auto-completion)',
    'apiSetup.protocol.googleGemini': 'Google Gemini',
  }
  const t = (key: string) => translations[key] ?? key

  it.each([
    ['openai-completions', 'OpenAI Chat Completions'],
    ['openai-responses', 'OpenAI Responses'],
    ['anthropic-messages', 'Anthropic Messages'],
    ['google-generative-ai', 'Google Gemini'],
  ] as const)('shows the %s protocol label', (api, expected) => {
    expect(getEndpointProtocolLabel(api, t)).toBe(expected)
  })

  it('omits a protocol label when none is stored', () => {
    expect(getEndpointProtocolLabel(undefined, t)).toBeUndefined()
  })

  it('shows the custom Base URL label for preserved endpoints', () => {
    expect(getEndpointProtocolLabel('openai-completions', t, true))
      .toBe('Custom Base URL (no auto-completion)')
  })
})

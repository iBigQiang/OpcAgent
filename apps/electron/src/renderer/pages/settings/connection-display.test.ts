import { describe, expect, it } from 'bun:test'
import { getPlatformConnectionDescription } from './connection-display'

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

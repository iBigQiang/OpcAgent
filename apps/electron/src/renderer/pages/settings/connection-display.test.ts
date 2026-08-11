import { describe, expect, it } from 'bun:test'
import { getPlatformConnectionDescription } from './connection-display'

describe('getPlatformConnectionDescription', () => {
  it('shows AnyRouter-CC as the Claude Code CLI runtime', () => {
    expect(getPlatformConnectionDescription('anyrouter')).toBe('AnyRouter-CC · Claude Code CLI')
  })

  it('shows the concise AnyRouter-Pi label', () => {
    expect(getPlatformConnectionDescription('anyrouter_pi')).toBe('AnyRouter-Pi')
  })

  it('shows AgentRouter as the Pi-compatible runtime', () => {
    expect(getPlatformConnectionDescription('agentrouter')).toBe('AgentRouter · Pi Backend Compatible')
  })

  it('does not replace generic endpoint descriptions', () => {
    expect(getPlatformConnectionDescription()).toBeUndefined()
  })
})

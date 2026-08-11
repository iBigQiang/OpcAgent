import { describe, expect, it } from 'bun:test'
import { normalizeApiKeyInput } from '../llm-connections.ts'

describe('normalizeApiKeyInput', () => {
  it('trims surrounding whitespace from a raw key', () => {
    expect(normalizeApiKeyInput('  sk-example_123  ')).toBe('sk-example_123')
  })

  it('rejects labels, line breaks, and masked Unicode values', () => {
    expect(() => normalizeApiKeyInput('AgentRouter sk-example')).toThrow('invalid characters')
    expect(() => normalizeApiKeyInput('sk-example\ncontinued')).toThrow('invalid characters')
    expect(() => normalizeApiKeyInput('sk-example••••end')).toThrow('invalid characters')
  })

  it('keeps an empty value for keyless local endpoints and edit flows', () => {
    expect(normalizeApiKeyInput('   ')).toBe('')
  })
})

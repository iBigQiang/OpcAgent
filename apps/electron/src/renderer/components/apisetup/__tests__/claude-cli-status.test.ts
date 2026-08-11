import { describe, expect, it } from 'bun:test'
import {
  getClaudeCliStatusMessage,
  hasSavedClaudeCliPath,
  shouldShowClaudeCliControls,
} from '../claude-cli-status'

describe('AnyRouter-CC Claude CLI controls', () => {
  it('shows controls only for the AnyRouter-CC preset', () => {
    expect(shouldShowClaudeCliControls('anyrouter')).toBe(true)
    expect(shouldShowClaudeCliControls('anyrouter_pi')).toBe(false)
    expect(shouldShowClaudeCliControls('agentrouter')).toBe(false)
  })

  it('identifies a saved Claude CLI path that can be cleared', () => {
    expect(hasSavedClaudeCliPath({
      found: true,
      path: 'C:\\Tools\\claude.cmd',
      source: 'persisted',
      platform: 'win32',
    })).toBe(true)
    expect(hasSavedClaudeCliPath({
      found: true,
      path: 'C:\\Tools\\claude.cmd',
      source: 'path',
      platform: 'win32',
    })).toBe(false)
  })

  it('describes found and invalid CLI states inline', () => {
    expect(getClaudeCliStatusMessage({
      found: true,
      path: '/usr/local/bin/claude',
      version: '2.0.0',
      platform: 'darwin',
    })).toBe('Found Claude Code CLI 2.0.0.')
    expect(getClaudeCliStatusMessage({
      found: false,
      path: null,
      error: 'Executable failed validation.',
      platform: 'linux',
    })).toBe('Executable failed validation.')
  })
})

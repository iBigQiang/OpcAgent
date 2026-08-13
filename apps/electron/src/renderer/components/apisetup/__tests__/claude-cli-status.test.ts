import { describe, expect, it } from 'bun:test'
import {
  getClaudeCliStatusMessage,
  hasSavedClaudeCliPath,
  shouldShowClaudeCliControls,
} from '../claude-cli-status'

describe('AnyRouter-CC Claude CLI controls', () => {
  const translations: Record<string, string> = {
    'apiSetup.claudeCli.checking': 'Checking Claude Code CLI...',
    'apiSetup.claudeCli.notFound': 'Claude Code CLI was not found. Choose its executable to continue.',
    'apiSetup.claudeCli.found': 'Found Claude Code CLI.',
  }
  const t = (key: string, options?: Record<string, unknown>) => {
    if (key === 'apiSetup.claudeCli.foundVersion') return `Found Claude Code CLI ${String(options?.version)}.`
    return translations[key] ?? key
  }

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
    }, t)).toBe('Found Claude Code CLI 2.0.0.')
    expect(getClaudeCliStatusMessage({
      found: false,
      path: null,
      error: 'Executable failed validation.',
      platform: 'linux',
    }, t)).toBe('Executable failed validation.')
  })
})

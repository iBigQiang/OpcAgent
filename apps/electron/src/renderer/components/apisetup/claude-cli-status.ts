import type { ClaudeCliStatus } from '../../../shared/types'

export function shouldShowClaudeCliControls(activePreset: string): boolean {
  return activePreset === 'anyrouter'
}

export function hasSavedClaudeCliPath(status: ClaudeCliStatus | null): boolean {
  return status?.source === 'persisted' && Boolean(status.path)
}

export function getClaudeCliStatusMessage(status: ClaudeCliStatus | null, actionError?: string): string {
  if (actionError) return actionError
  if (!status) return 'Checking Claude Code CLI...'
  if (!status.found) return status.error || 'Claude Code CLI was not found. Choose its executable to continue.'
  return status.version
    ? `Found Claude Code CLI ${status.version}.`
    : 'Found Claude Code CLI.'
}

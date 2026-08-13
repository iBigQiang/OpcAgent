import type { ClaudeCliStatus } from '../../../shared/types'

type Translate = (key: string, options?: Record<string, unknown>) => string

export function shouldShowClaudeCliControls(activePreset: string): boolean {
  return activePreset === 'anyrouter'
}

export function hasSavedClaudeCliPath(status: ClaudeCliStatus | null): boolean {
  return status?.source === 'persisted' && Boolean(status.path)
}

export function getClaudeCliStatusMessage(
  status: ClaudeCliStatus | null,
  t: Translate,
  actionError?: string,
): string {
  if (actionError) return actionError
  if (!status) return t('apiSetup.claudeCli.checking')
  if (!status.found) return status.error || t('apiSetup.claudeCli.notFound')
  return status.version
    ? t('apiSetup.claudeCli.foundVersion', { version: status.version })
    : t('apiSetup.claudeCli.found')
}

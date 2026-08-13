import type { PairingCodeManager } from './pairing'
import type { PlatformType } from './types'
/** Parses only the deliberate `/pair <code>` command; all other text remains agent input. */
export function consumePairCommand(input: string, workspaceId: string, platform: PlatformType, manager: PairingCodeManager): { sessionId: string } | null { const match = input.trim().match(/^\/pair\s+([a-f0-9]{8})$/i); if (!match) return null; const value = manager.consume(match[1]!, workspaceId, platform); return value ? { sessionId: value.sessionId } : null }

import type { CSSProperties } from 'react'

export type SessionStatus = string | { id: string; label: string; icon?: unknown }

/** Labels reuse the neutral status style without restoring the removed custom-status product. */
export function getStatusIconStyle(_status: SessionStatus): CSSProperties {
  return { color: 'currentColor' }
}

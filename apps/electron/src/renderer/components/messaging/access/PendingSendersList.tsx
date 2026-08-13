/**
 * "Pending requests" — recent senders the gateway rejected. Renders nothing
 * when the list is empty.
 *
 * The Allow button label depends on the entry's `reason`:
 *  - `'not-owner'` → "Allow" (promotes to workspace owner)
 *  - `'not-on-binding-allowlist'` → "Allow for this chat" (appends to that
 *    binding's allow-list only — does NOT grant workspace ownership)
 *
 * "Ignore" drops the row from the pending list without granting access.
 */

import type { PendingSender } from './types'

interface Props {
  pending: PendingSender[]
  onAllow: (sender: PendingSender) => void
  onIgnore: (sender: PendingSender) => void
}

export function PendingSendersList(_props: Props): null {
  return null
}

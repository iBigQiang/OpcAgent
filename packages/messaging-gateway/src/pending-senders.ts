import type { PlatformType } from './types'

export type PendingSenderReason = 'not-owner' | 'not-on-binding-allowlist'

export interface PendingSender {
  platform: PlatformType
  senderId: string
  senderName?: string
  bindingId?: string
  reason: PendingSenderReason
  createdAt: number
}

/**
 * Bounded, workspace-local pending queue. It intentionally stores no message
 * text or credentials. The registry owns persistence of an approved owner.
 */
export class PendingSenders {
  private readonly values = new Map<string, PendingSender>()

  constructor(
    private readonly max = 100,
    private readonly onChange?: () => void,
  ) {}

  add(value: PendingSender): void {
    const key = this.key(value)
    this.values.set(key, { ...value })
    while (this.values.size > this.max) this.values.delete(this.values.keys().next().value!)
    this.onChange?.()
  }

  list(platform?: PlatformType): PendingSender[] {
    return [...this.values.values()]
      .filter(item => !platform || item.platform === platform)
      .map(item => ({ ...item }))
  }

  find(platform: PlatformType, senderId: string): PendingSender | undefined {
    return this.list(platform).find(item => item.senderId === senderId)
  }

  dismiss(platform: PlatformType, senderId: string): boolean {
    let removed = false
    for (const [key, value] of this.values) {
      if (value.platform === platform && value.senderId === senderId) {
        this.values.delete(key)
        removed = true
      }
    }
    if (removed) this.onChange?.()
    return removed
  }

  private key(value: PendingSender): string {
    return `${value.platform}:${value.senderId}:${value.reason}:${value.bindingId ?? ''}`
  }
}

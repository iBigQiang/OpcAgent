import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

export type PendingSenderKey = Required<Pick<PendingSender, 'reason'>> & Pick<PendingSender, 'bindingId'>
const TTL_MS = 7 * 24 * 60 * 60_000

/**
 * Bounded, workspace-local pending queue. It intentionally stores no message
 * text or credentials. The registry owns persistence of an approved owner.
 */
export class PendingSenders {
  private readonly values = new Map<string, PendingSender>()
  private readonly filePath?: string
  private max: number

  constructor(
    storageDirOrMax?: string | number,
    max = 50,
    private readonly onChange?: () => void,
  ) {
    this.max = typeof storageDirOrMax === 'number' ? storageDirOrMax : max
    if (typeof storageDirOrMax === 'string') this.filePath = join(storageDirOrMax, 'pending.json')
    this.load()
  }

  add(value: PendingSender): void {
    this.prune()
    const key = this.key(value)
    this.values.set(key, { ...value })
    while (this.values.size > this.max) this.values.delete(this.values.keys().next().value!)
    this.save()
  }

  list(platform?: PlatformType): PendingSender[] {
    this.prune()
    return [...this.values.values()]
      .filter(item => !platform || item.platform === platform)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(item => ({ ...item }))
  }

  find(platform: PlatformType, senderId: string, entryKey: PendingSenderKey): PendingSender | undefined {
    return this.values.get(this.key({ platform, senderId, ...entryKey, createdAt: 0 }))
  }

  dismiss(platform: PlatformType, senderId: string, entryKey: PendingSenderKey): boolean {
    const removed = this.values.delete(this.key({ platform, senderId, ...entryKey, createdAt: 0 }))
    if (removed) this.save()
    return removed
  }

  private prune(): void {
    const threshold = Date.now() - TTL_MS
    let changed = false
    for (const [key, value] of this.values) if (value.createdAt < threshold) { this.values.delete(key); changed = true }
    if (changed) this.save()
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return
    try {
      const values = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      if (!Array.isArray(values)) return
      for (const value of values) if (isPendingSender(value) && value.createdAt >= Date.now() - TTL_MS) this.values.set(this.key(value), value)
      while (this.values.size > this.max) this.values.delete(this.values.keys().next().value!)
    } catch { this.values.clear() }
  }

  private save(): void {
    if (this.filePath) {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const temporary = `${this.filePath}.tmp`
      writeFileSync(temporary, `${JSON.stringify([...this.values.values()], null, 2)}\n`, 'utf8')
      renameSync(temporary, this.filePath)
    }
    this.onChange?.()
  }

  private key(value: PendingSender): string {
    return `${value.platform}:${value.senderId}:${value.reason}:${value.bindingId ?? ''}`
  }
}

function isPendingSender(value: unknown): value is PendingSender {
  if (!value || typeof value !== 'object') return false
  const item = value as PendingSender
  return ['telegram', 'whatsapp', 'lark'].includes(item.platform) && typeof item.senderId === 'string' && (item.reason === 'not-owner' || item.reason === 'not-on-binding-allowlist') && typeof item.createdAt === 'number' && (item.bindingId === undefined || typeof item.bindingId === 'string')
}

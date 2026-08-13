import { randomInt } from 'node:crypto'
import type { PlatformType } from './types'

export type PairingKind = 'session' | 'workspace-supergroup'
export interface PairingCode {
  code: string
  workspaceId: string
  sessionId?: string
  platform: PlatformType
  kind: PairingKind
  expiresAt: number
}
export const PAIRING_TTL_MS = 5 * 60_000
export const PAIRING_RATE_LIMIT_PER_MINUTE = 10
export const PAIR_CONSUME_RATE_PER_MINUTE = 5
/** Bounds distributed guessing across many sender identities for one workspace. */
export const PAIR_CONSUME_WORKSPACE_RATE_PER_MINUTE = 20

interface RateBucket { startedAt: number; count: number }
/** In-memory, single-use pairing codes; never persisted with messages or credentials. */
export class PairingCodeManager {
  private readonly codes = new Map<string, PairingCode>()
  private readonly generated = new Map<string, RateBucket>()
  private readonly consumed = new Map<string, RateBucket>()
  private readonly workspaceConsumed = new Map<string, RateBucket>()
  constructor(private readonly now: () => number = Date.now, private readonly ttlMs = PAIRING_TTL_MS) {}
  create(workspaceId: string, sessionId: string, platform: PlatformType): PairingCode {
    return this.createEntry({ workspaceId, sessionId, platform, kind: 'session' })
  }
  createSupergroup(workspaceId: string, platform: 'telegram'): PairingCode {
    return this.createEntry({ workspaceId, platform, kind: 'workspace-supergroup' })
  }
  canGenerate(workspaceId: string): boolean { return this.hasCapacity(this.generated, workspaceId, PAIRING_RATE_LIMIT_PER_MINUTE) }
  canConsume(workspaceId: string, platform: PlatformType, senderId: string): boolean {
    return this.hasCapacity(this.consumed, `${workspaceId}:${platform}:${senderId}`, PAIR_CONSUME_RATE_PER_MINUTE)
  }
  consume(code: string, workspaceId: string, platform: PlatformType, senderId = ''): PairingCode | null {
    this.prune()
    if (!this.recordUse(this.consumed, `${workspaceId}:${platform}:${senderId}`, PAIR_CONSUME_RATE_PER_MINUTE)) return null
    if (!this.recordUse(this.workspaceConsumed, `${workspaceId}:${platform}`, PAIR_CONSUME_WORKSPACE_RATE_PER_MINUTE)) return null
    const value = this.codes.get(code)
    if (!value || value.workspaceId !== workspaceId || value.platform !== platform) return null
    this.codes.delete(code)
    return value
  }
  clearWorkspace(workspaceId: string): void { for (const [code, value] of this.codes) if (value.workspaceId === workspaceId) this.codes.delete(code) }
  private prune(): void { for (const [code, value] of this.codes) if (value.expiresAt <= this.now()) this.codes.delete(code) }
  private createEntry(input: Omit<PairingCode, 'code' | 'expiresAt'>): PairingCode {
    this.prune()
    if (!this.recordUse(this.generated, input.workspaceId, PAIRING_RATE_LIMIT_PER_MINUTE)) throw new Error('Too many pairing code requests. Please wait a moment and try again.')
    let code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    while (this.codes.has(code)) code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const value: PairingCode = { ...input, code, expiresAt: this.now() + this.ttlMs }
    this.codes.set(code, value)
    return value
  }
  private hasCapacity(store: Map<string, RateBucket>, key: string, limit: number): boolean {
    const now = this.now()
    const prior = store.get(key)
    return !prior || now - prior.startedAt >= 60_000 || prior.count < limit
  }
  private recordUse(store: Map<string, RateBucket>, key: string, limit: number): boolean {
    const now = this.now()
    const prior = store.get(key)
    if (!prior || now - prior.startedAt >= 60_000) {
      store.set(key, { startedAt: now, count: 1 })
      return true
    }
    if (prior.count >= limit) return false
    prior.count++
    return true
  }
}

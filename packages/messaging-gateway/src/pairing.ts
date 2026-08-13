import { randomBytes } from 'node:crypto'
import type { PlatformType } from './types'

export interface PairingCode { code: string; workspaceId: string; sessionId: string; platform: PlatformType; expiresAt: number }
/** In-memory, single-use pairing codes; never persisted with messages or credentials. */
export class PairingCodeManager {
  private readonly codes = new Map<string, PairingCode>()
  constructor(private readonly now: () => number = Date.now, private readonly ttlMs = 10 * 60_000) {}
  create(workspaceId: string, sessionId: string, platform: PlatformType): PairingCode { this.prune(); const code = randomBytes(4).toString('hex'); const value = { code, workspaceId, sessionId, platform, expiresAt: this.now() + this.ttlMs }; this.codes.set(code, value); return value }
  consume(code: string, workspaceId: string, platform: PlatformType): PairingCode | null { this.prune(); const value = this.codes.get(code); if (!value || value.workspaceId !== workspaceId || value.platform !== platform) return null; this.codes.delete(code); return value }
  clearWorkspace(workspaceId: string): void { for (const [code, value] of this.codes) if (value.workspaceId === workspaceId) this.codes.delete(code) }
  private prune(): void { for (const [code, value] of this.codes) if (value.expiresAt <= this.now()) this.codes.delete(code) }
}

import { randomBytes } from 'node:crypto'
export class PlanTokenStore { private readonly tokens = new Map<string, { bindingId: string; expiresAt: number }>(); constructor(private readonly now: () => number = Date.now) {} issue(bindingId: string): string { const token = randomBytes(16).toString('hex'); this.tokens.set(token, { bindingId, expiresAt: this.now() + 5 * 60_000 }); return token } consume(token: string): string | null { const value = this.tokens.get(token); this.tokens.delete(token); return value && value.expiresAt > this.now() ? value.bindingId : null } }
export interface PlanTokenEntry { bindingId: string; sessionId: string; planPath: string; createdAt: number }
export class PlanTokenRegistry {
  private readonly tokens = new Map<string, PlanTokenEntry>()
  constructor(private readonly ttlMs = 30 * 60_000, private readonly now: () => number = Date.now) {}
  issue(bindingId: string, sessionId: string, planPath = ''): string { this.revokeForBinding(bindingId); const token = randomBytes(12).toString('base64url'); this.tokens.set(token, { bindingId, sessionId, planPath, createdAt: this.now() }); return token }
  resolve(token: string): PlanTokenEntry | null { const entry = this.tokens.get(token); return entry && this.now() - entry.createdAt <= this.ttlMs ? { ...entry } : null }
  consume(token: string): PlanTokenEntry | null { const entry = this.resolve(token); this.tokens.delete(token); return entry }
  revoke(token: string): void { this.tokens.delete(token) }
  revokeForBinding(bindingId: string): void { for (const [token, entry] of this.tokens) if (entry.bindingId === bindingId) this.tokens.delete(token) }
  size(): number { return this.tokens.size }
}

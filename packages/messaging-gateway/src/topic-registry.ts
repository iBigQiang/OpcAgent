import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PlatformType } from './types'
export interface TopicBinding { workspaceId: string; platform: PlatformType; name: string; channelId: string; threadId: number }
/** Telegram topic lookup isolated by workspace and channel. */
export class TopicRegistry {
  private readonly topics = new Map<string, TopicBinding>()
  private readonly inflight = new Map<string, Promise<TopicBinding>>()
  private readonly filePath?: string
  constructor(storageDir?: string) { if (storageDir) { this.filePath = join(storageDir, 'topic-registry.json'); this.load() } }
  private key(workspaceId: string, channelId: string, name: string): string { return `${workspaceId}\u0000${channelId}\u0000${name}` }
  get(workspaceId: string, channelId: string, name: string): TopicBinding | undefined { const value = this.topics.get(this.key(workspaceId, channelId, name)); return value ? { ...value } : undefined }
  put(value: TopicBinding): void { this.topics.set(this.key(value.workspaceId, value.channelId, value.name), { ...value }); this.save() }
  async findOrCreate(value: Omit<TopicBinding, 'threadId'>, create: () => Promise<{ threadId: number }>): Promise<TopicBinding> {
    const key = this.key(value.workspaceId, value.channelId, value.name)
    const existing = this.topics.get(key)
    if (existing) return { ...existing }
    const pending = this.inflight.get(key)
    if (pending) return pending
    const task = (async () => { const again = this.topics.get(key); if (again) return { ...again }; const created = await create(); const topic = { ...value, threadId: created.threadId }; this.put(topic); return { ...topic } })()
    this.inflight.set(key, task)
    try { return await task } finally { this.inflight.delete(key) }
  }
  remove(workspaceId: string, channelId: string, name: string): boolean { const removed = this.topics.delete(this.key(workspaceId, channelId, name)); if (removed) this.save(); return removed }
  clearWorkspace(workspaceId: string): void { let changed = false; for (const [key, value] of this.topics) if (value.workspaceId === workspaceId) { this.topics.delete(key); changed = true }; if (changed) this.save() }
  private load(): void { if (!this.filePath || !existsSync(this.filePath)) return; try { const payload = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown; const values = Array.isArray(payload) ? payload : (payload as { entries?: unknown })?.entries; if (!Array.isArray(values)) return; for (const value of values) if (isTopic(value)) this.topics.set(this.key(value.workspaceId, value.channelId, value.name), { ...value }) } catch { this.topics.clear() } }
  private save(): void { if (!this.filePath) return; mkdirSync(dirname(this.filePath), { recursive: true }); const temporary = `${this.filePath}.tmp`; writeFileSync(temporary, `${JSON.stringify({ version: 1, entries: [...this.topics.values()] }, null, 2)}\n`, 'utf8'); renameSync(temporary, this.filePath) }
}
function isTopic(value: unknown): value is TopicBinding { if (!value || typeof value !== 'object') return false; const item = value as TopicBinding; return ['telegram', 'whatsapp', 'lark'].includes(item.platform) && typeof item.workspaceId === 'string' && typeof item.name === 'string' && typeof item.channelId === 'string' && typeof item.threadId === 'number' }

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_MESSAGING_CONFIG, type MessagingConfig, type MessagingLogger } from './types'

const NOOP: MessagingLogger = { info() {}, warn() {}, error() {} }

/** Non-secret, workspace-local messaging settings. Secrets never enter this file. */
export class ConfigStore {
  private readonly filePath: string
  private config: MessagingConfig
  constructor(storageDir: string, private readonly logger: MessagingLogger = NOOP) { this.filePath = join(storageDir, 'config.json'); this.config = this.load() }
  get(): MessagingConfig { return JSON.parse(JSON.stringify(this.config)) as MessagingConfig }
  update(patch: Partial<MessagingConfig>): MessagingConfig {
    const platforms = { ...this.config.platforms }
    for (const [platform, value] of Object.entries(patch.platforms ?? {})) {
      if (value) platforms[platform as keyof typeof platforms] = { ...platforms[platform as keyof typeof platforms], ...value }
    }
    const access = { ...this.config.access }
    for (const [platform, value] of Object.entries(patch.access ?? {})) {
      if (value) access[platform as keyof typeof access] = { ...access[platform as keyof typeof access], ...value }
    }
    this.config = { version: 1, enabled: patch.enabled ?? this.config.enabled, platforms, access }
    this.save()
    return this.get()
  }
  private load(): MessagingConfig {
    if (!existsSync(this.filePath)) return JSON.parse(JSON.stringify(DEFAULT_MESSAGING_CONFIG))
    try { const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<MessagingConfig>; if (parsed.version !== 1 || typeof parsed.enabled !== 'boolean' || !parsed.platforms || typeof parsed.platforms !== 'object') throw new Error('unsupported messaging config'); return { version: 1, enabled: parsed.enabled, platforms: parsed.platforms, access: parsed.access ?? {} } }
    catch (error) { this.logger.error('Messaging config rejected; leaving gateway disabled', { error: error instanceof Error ? error.message : 'invalid JSON' }); return JSON.parse(JSON.stringify(DEFAULT_MESSAGING_CONFIG)) }
  }
  private save(): void { mkdirSync(dirname(this.filePath), { recursive: true }); const temp = `${this.filePath}.tmp`; writeFileSync(temp, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8'); renameSync(temp, this.filePath) }
}

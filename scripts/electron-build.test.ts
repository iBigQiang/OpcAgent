import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CLAUDE_SDK = '@anthropic-ai/claude-agent-sdk'
const TELEGRAM_SDK = 'grammy'

describe('Electron CJS build configuration', () => {
  it('keeps the removed Claude SDK out of main-process bundles', () => {
    const buildScript = readFileSync(resolve(import.meta.dir, 'electron-build-main.ts'), 'utf-8')
    const devScript = readFileSync(resolve(import.meta.dir, 'electron-dev.ts'), 'utf-8')
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dir, '../apps/electron/package.json'), 'utf-8'),
    ) as { scripts: Record<string, string> }

    expect(buildScript).not.toContain(CLAUDE_SDK)
    expect(devScript).not.toContain(CLAUDE_SDK)
    expect(devScript).toMatch(
      /const mainContext = await esbuild\.context\([\s\S]*?external: MAIN_BUNDLE_EXTERNALS/,
    )
    expect(packageJson.scripts['build:main']).not.toContain(CLAUDE_SDK)
    expect(packageJson.scripts['build:main:win']).not.toContain(CLAUDE_SDK)
  })

  it('keeps agent runtime modules out of the preload dependency graph', () => {
    const preload = readFileSync(
      resolve(import.meta.dir, '../apps/electron/src/preload/bootstrap.ts'),
      'utf-8',
    )
    const sharedPackage = JSON.parse(
      readFileSync(resolve(import.meta.dir, '../packages/shared/package.json'), 'utf-8'),
    ) as { exports: Record<string, string> }

    expect(preload).not.toContain("from '@opcagent/shared/auth'")
    expect(preload).toContain("from '@opcagent/shared/auth/callback-server'")
    expect(preload).toContain("from '@opcagent/shared/auth/chatgpt-oauth-config'")
    expect(sharedPackage.exports['./auth/callback-server']).toBe('./src/auth/callback-server.ts')
    expect(sharedPackage.exports['./auth/chatgpt-oauth-config']).toBe(
      './src/auth/chatgpt-oauth-config.ts',
    )
  })

  it('bundles the Telegram SDK into the packaged main process', () => {
    const adapter = readFileSync(
      resolve(
        import.meta.dir,
        '../packages/messaging-gateway/src/adapters/telegram/index.ts',
      ),
      'utf-8',
    )

    expect(adapter).toContain(`from '${TELEGRAM_SDK}'`)
    expect(adapter).not.toContain(`dynamicImport('${TELEGRAM_SDK}')`)
  })
})

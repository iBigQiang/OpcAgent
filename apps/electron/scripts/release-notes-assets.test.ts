import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appDir = resolve(import.meta.dir, '..')
const source = (relative: string) => readFileSync(resolve(appDir, relative), 'utf-8')

describe('packaged release notes', () => {
  it('copies and validates the current version release note', () => {
    const { version } = JSON.parse(source('package.json')) as { version: string }
    const copyAssets = source('scripts/copy-assets.ts')
    const validateAssets = source('scripts/validate-assets.ts')

    expect(copyAssets).toContain("cpSync(join(source, 'release-notes'), join(destination, 'release-notes'), { recursive: true })")
    expect(validateAssets).toContain('`dist/resources/release-notes/${version}.md`')
    expect(validateAssets).toContain('Packaged release note is empty')
    expect(source(`resources/release-notes/${version}.md`).trim()).not.toBe('')
  })
})

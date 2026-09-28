import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { extractReleaseSummary, metadataPathFromArgs, updateCiReadme, updateReadmeBlock, updateReadmeManifest, validateMetadata } from './update-ci-readme'

// 假构建只用于纯函数和临时仓库，不能写入项目 README。
const metadata = () => ({
  status: 'success', repository: 'iBigQiang/OpcAgent', branch: 'main', sourceSha: '1234567890abcdef'.repeat(2) + '12345678',
  runId: 987654321, runAttempt: 2, buildTime: '2026-09-28T08:00:00Z',
  artifacts: [
    { platform: 'windows-x64', id: 11, name: 'Windows 构建 [测试]' },
    { platform: 'macos-arm64', id: 12, name: 'macOS 构建' },
    { platform: 'linux-x64', id: 13, name: 'Linux 构建' },
  ],
})
const releaseNotes = '# OPC Agent 0.1.11\n\n### 新增\n\n- 跨渠道保留上下文。\n- 会话工具可以继续使用。\n\n### 修复\n\n- 重启恢复已保存选择。\n'
const readme = '# 人工标题\n\n人工介绍与链接 [文档](./docs/README.md)。\n\n## Current release\n\n正式版本 **0.1.10**，保持原样。\n\n## Features\n\n人工尾部。\n'
const digest = (text: string) => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex')
const manifest = () => JSON.stringify({ version: 2, modified: {
  'other.ts': { sha256: 'b'.repeat(64), reason: '其他文件不可改' },
  'README.md': { reason: '保留原因 {以及排版}', sha256: 'a'.repeat(64) },
}, mkOnly: {} }, null, 2) + '\n'

const fixtures: Array<{ root: string; files: string[]; dirs: string[] }> = []
function fixture() {
  const tempRoot = resolve(import.meta.dir, '../.tmp')
  mkdirSync(tempRoot, { recursive: true })
  const root = mkdtempSync(join(tempRoot, 'ci-readme-test-'))
  const files = ['package.json', 'README.md', 'scripts/craft-source-overrides.json', 'apps/electron/resources/release-notes/0.1.11.md']
  const dirs = new Set<string>([root])
  const content = [JSON.stringify({ version: '0.1.11' }), readme, manifest(), releaseNotes]
  files.forEach((file, index) => {
    let dir = dirname(join(root, file))
    while (dir !== root) { dirs.add(dir); dir = dirname(dir) }
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content[index]!)
  })
  fixtures.push({ root, files, dirs: [...dirs].sort((a, b) => b.length - a.length) })
  return root
}
afterEach(() => {
  for (const item of fixtures.splice(0)) {
    // 仅逐个删除本测试明确创建的文件，再删除已空的已知目录。
    for (const file of item.files) unlinkSync(join(item.root, file))
    for (const dir of item.dirs) rmdirSync(dir)
  }
})

describe('成功 CI 构建的 README 托管区块', () => {
  it('在正式发布段之前插入中文记录，完整保留人工内容', () => {
    const next = updateReadmeBlock(readme, validateMetadata(metadata()), '0.1.11', releaseNotes)
    expect(next.indexOf('## 最新验证构建')).toBeLessThan(next.indexOf('## Current release'))
    expect(next.replace(/<!-- opcagent:ci-build:start -->[\s\S]*?<!-- opcagent:ci-build:end -->\n\n/, '')).toBe(readme)
    expect(next).toContain('**0.1.11**')
    expect(next).toContain('actions/runs/987654321/attempts/2')
    expect(next).toContain('actions/runs/987654321/artifacts/11')
    expect(next).toContain('Artifact 保留期为 **30 天**')
    expect(next).toContain('下载 Artifact 需要登录 GitHub。')
    expect(next).toContain('releases/latest')
    expect(next).toContain('- 跨渠道保留上下文。')
  })

  it('仅替换既有区块且相同输入重复执行完全相同', () => {
    const source = readme.replace('## Current release', '<!-- opcagent:ci-build:start -->\n旧构建内容\n<!-- opcagent:ci-build:end -->\n\n## Current release')
    const data = validateMetadata(metadata())
    const next = updateReadmeBlock(source, data, '0.1.11', releaseNotes)
    expect(next).not.toContain('旧构建内容')
    expect(updateReadmeBlock(next, data, '0.1.11', releaseNotes)).toBe(next)
    expect(next.slice(next.indexOf('## Current release'))).toBe(source.slice(source.indexOf('## Current release')))
  })

  it('保留 CRLF 排版并对内容按 LF 计算哈希', () => {
    const source = readme.replaceAll('\n', '\r\n')
    const next = updateReadmeBlock(source, validateMetadata(metadata()), '0.1.11', releaseNotes)
    expect(next.replaceAll('\r\n', '')).not.toContain('\n')
    expect(updateReadmeManifest(manifest(), next)).toContain(digest(next.replaceAll('\r\n', '\n')))
  })

  it('拒绝损坏或重复标记，不猜测人工内容的范围', () => {
    for (const source of ['人工内容', readme + '<!-- opcagent:ci-build:start -->',
      '<!-- opcagent:ci-build:end -->\n<!-- opcagent:ci-build:start -->',
      '<!-- opcagent:ci-build:start --><!-- opcagent:ci-build:start --><!-- opcagent:ci-build:end -->']) {
      expect(() => updateReadmeBlock(source, validateMetadata(metadata()), '0.1.11', releaseNotes)).toThrow()
    }
  })

  it('摘要最多五项、每项最多160个字符，并忽略代码示例和子列表', () => {
    const notes = '# 中文说明\n```md\n- 不应展示的示例\n```\n- 第一项\n  - 子列表\n' +
      Array.from({ length: 6 }, (_, i) => `- 第${i + 2}项${'好'.repeat(200)}`).join('\n')
    const summary = extractReleaseSummary(notes)
    expect(summary).toHaveLength(5)
    expect(summary[0]).toBe('第一项')
    expect(summary.every(item => [...item].length <= 160)).toBe(true)
    expect(summary[1]).toEndWith('…')
    expect(summary.join('\n')).not.toContain('子列表')
    expect(() => extractReleaseSummary('# 没有改动条目')).toThrow()
  })
})

describe('元数据与外链注入约束', () => {
  it('允许真实单行 Unicode Artifact 名称，但不把名称插入 Markdown', () => {
    const input = metadata()
    input.artifacts[0]!.name = '[恶意外链](https://evil.example) 中文构建'
    const next = updateReadmeBlock(readme, validateMetadata(input), '0.1.11', releaseNotes)
    expect(next).not.toContain('evil.example')
    expect(next).toContain('https://github.com/iBigQiang/OpcAgent/actions/runs/987654321/artifacts/11')
  })

  it('只接受当前仓库、构建及 Artifact ID 的精确下载 URL', () => {
    const canonical = 'https://github.com/iBigQiang/OpcAgent/actions/runs/987654321/artifacts/11'
    expect(validateMetadata({ ...metadata(), artifacts: [{ ...metadata().artifacts[0], url: canonical }, ...metadata().artifacts.slice(1)] }).artifacts[0]!.url).toBe(canonical)
    for (const url of ['https://evil.example/artifact', canonical + '?redirect=evil', canonical.replace('/11', '/99'), 'https://github.com@evil.example/file']) {
      expect(() => validateMetadata({ ...metadata(), artifacts: [{ ...metadata().artifacts[0], url }, ...metadata().artifacts.slice(1)] })).toThrow('Artifact URL')
    }
  })

  it('拒绝失败、缺平台、重复平台及占位或恶意参数', () => {
    const invalid: unknown[] = [
      { ...metadata(), status: 'failure' }, { ...metadata(), status: 'in_progress' },
      { ...metadata(), artifacts: metadata().artifacts.slice(0, 2) },
      { ...metadata(), artifacts: [metadata().artifacts[0], metadata().artifacts[0], metadata().artifacts[2]] },
      { ...metadata(), repository: 'owner/repo/../evil' }, { ...metadata(), repository: 'owner/repo\n# injected' },
      { ...metadata(), branch: 'main\n## injected' }, { ...metadata(), branch: 'main](https://evil)' },
      { ...metadata(), sourceSha: 'pending' }, { ...metadata(), runId: 0 }, { ...metadata(), runId: '987654321' },
      { ...metadata(), runId: Number.MAX_SAFE_INTEGER + 1 }, { ...metadata(), runAttempt: -1 },
      { ...metadata(), buildTime: '2026-02-30T08:00:00Z' }, { ...metadata(), buildTime: '稍后补充' },
      { ...metadata(), artifacts: [{ ...metadata().artifacts[0], id: 0 }, ...metadata().artifacts.slice(1)] },
      { ...metadata(), artifacts: [{ ...metadata().artifacts[0], name: '构建\n新标题' }, ...metadata().artifacts.slice(1)] },
    ]
    for (const input of invalid) expect(() => validateMetadata(input)).toThrow()
  })

  it('严格解析 CLI 参数，禁止额外开关或缺少元数据', () => {
    expect(metadataPathFromArgs(['--metadata', '构建 元数据.json'])).toBe(resolve('构建 元数据.json'))
    for (const args of [[], ['--metadata'], ['--metadata', '--force'], ['--metadata', 'test.json', '--force'], ['--success', 'true']]) {
      expect(() => metadataPathFromArgs(args)).toThrow('用法')
    }
  })
})

describe('精准清单更新及写入边界', () => {
  it('只更改 README 哈希，保留原因、其他登记与原始 JSON 排版', () => {
    const before = manifest().replaceAll('\n', '\r\n')
    const next = updateReadmeManifest(before, readme)
    expect(next).toBe(before.replace('a'.repeat(64), digest(readme)))
    expect(next).toContain('b'.repeat(64))
    expect(next).toContain('保留原因 {以及排版}')
    const inMkOnly = JSON.stringify({ modified: {}, mkOnly: { 'README.md': { sha256: 'c'.repeat(64), reason: '登记' } } })
    expect(updateReadmeManifest(inMkOnly, readme)).toBe(inMkOnly.replace('c'.repeat(64), digest(readme)))
  })

  it('缺失或重复 README 登记时报错', () => {
    const entry = { sha256: 'a'.repeat(64), reason: '测试' }
    expect(() => updateReadmeManifest(JSON.stringify({ modified: {}, mkOnly: {} }), readme)).toThrow('README.md')
    expect(() => updateReadmeManifest(JSON.stringify({ modified: { 'README.md': entry }, mkOnly: { 'README.md': entry } }), readme)).toThrow('README.md')
  })

  it('按当前 package 版本读取说明，第二次执行不写文件', () => {
    const root = fixture()
    expect(updateCiReadme(root, metadata())).toEqual(['README.md', 'scripts/craft-source-overrides.json'])
    const first = readFileSync(join(root, 'README.md'), 'utf8')
    const modifiedAt = statSync(join(root, 'README.md')).mtimeMs
    expect(first).toContain('0.1.11')
    expect(first).toContain('正式版本 **0.1.10**，保持原样。')
    expect(updateCiReadme(root, metadata())).toEqual([])
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(first)
    expect(statSync(join(root, 'README.md')).mtimeMs).toBe(modifiedAt)
  })

  it('缺平台、失败状态和清单缺项都不写入 README 或清单', () => {
    const root = fixture()
    for (const input of [{ ...metadata(), artifacts: [] }, { ...metadata(), status: 'failure' }]) {
      expect(() => updateCiReadme(root, input)).toThrow()
      expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(readme)
      expect(readFileSync(join(root, 'scripts/craft-source-overrides.json'), 'utf8')).toBe(manifest())
    }
    const missing = '{"modified":{},"mkOnly":{}}'
    writeFileSync(join(root, 'scripts/craft-source-overrides.json'), missing)
    expect(() => updateCiReadme(root, metadata())).toThrow('README.md')
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(readme)
    expect(readFileSync(join(root, 'scripts/craft-source-overrides.json'), 'utf8')).toBe(missing)
  })
})

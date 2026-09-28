#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const START = '<!-- opcagent:ci-build:start -->'
const END = '<!-- opcagent:ci-build:end -->'
const PLATFORMS = ['windows-x64', 'macos-arm64', 'linux-x64'] as const
const PLATFORM_NAMES = { 'windows-x64': 'Windows x64', 'macos-arm64': 'macOS Apple Silicon', 'linux-x64': 'Linux x64' }

export interface CiBuildMetadata {
  status: 'success'
  repository: string
  branch: string
  sourceSha: string
  runId: number
  runAttempt: number
  buildTime: string
  artifacts: Array<{ platform: typeof PLATFORMS[number]; id: number; name: string; url: string }>
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} 必须是正安全整数`)
  return value
}

/** 元数据由成功构建的工作流从 GitHub API 取得；这里不推测或预填构建结果。 */
export function validateMetadata(input: unknown): CiBuildMetadata {
  const value = object(input, '构建元数据')
  if (value.status !== 'success') throw new Error('仅允许写入明确成功的构建')
  const repository = value.repository
  if (typeof repository !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(repository)
    || ['.', '..'].includes(repository.split('/')[1]!)) throw new Error('repository 必须是合法的 owner/name')
  const branch = value.branch
  if (typeof branch !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}._/-]{0,199}$/u.test(branch)
    || branch.includes('..') || branch.endsWith('.') || branch.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))) {
    throw new Error('branch 必须是单行合法分支名')
  }
  if (typeof value.sourceSha !== 'string' || !/^[a-fA-F0-9]{40}$/.test(value.sourceSha)) throw new Error('sourceSha 必须是完整的 40 位提交 SHA')
  const runId = positiveInteger(value.runId, 'runId')
  const runAttempt = positiveInteger(value.runAttempt, 'runAttempt')
  const buildTime = value.buildTime
  if (typeof buildTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(buildTime)
    || !Number.isFinite(Date.parse(buildTime))
    || ![new Date(buildTime).toISOString(), new Date(buildTime).toISOString().replace('.000Z', 'Z')].includes(buildTime)) {
    throw new Error('buildTime 必须是有效的 UTC ISO 8601 时间')
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== PLATFORMS.length) throw new Error('必须提供三个平台的实际 Artifact')
  const artifacts = value.artifacts.map((item, index) => {
    const artifact = object(item, `artifacts[${index}]`)
    if (!PLATFORMS.includes(artifact.platform as typeof PLATFORMS[number])) throw new Error('Artifact 平台不受支持')
    const id = positiveInteger(artifact.id, 'Artifact id')
    if (typeof artifact.name !== 'string' || !artifact.name.trim() || artifact.name.length > 300 || /[\u0000-\u001f\u007f\u2028\u2029]/.test(artifact.name)) {
      throw new Error('Artifact name 必须是非空单行名称')
    }
    const url = `https://github.com/${repository}/actions/runs/${runId}/artifacts/${id}`
    if (artifact.url !== undefined && artifact.url !== url) throw new Error('Artifact URL 必须匹配当前仓库、构建及实际 Artifact ID')
    return { platform: artifact.platform as typeof PLATFORMS[number], id, name: artifact.name, url }
  })
  if (new Set(artifacts.map(item => item.platform)).size !== PLATFORMS.length
    || new Set(artifacts.map(item => item.id)).size !== PLATFORMS.length
    || new Set(artifacts.map(item => item.name)).size !== PLATFORMS.length) throw new Error('三个平台及其 Artifact ID、名称必须唯一')
  return { status: 'success', repository, branch, sourceSha: value.sourceSha.toLowerCase(), runId, runAttempt, buildTime, artifacts }
}

function escapeMarkdown(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}[\]()#+.!|])/g, '\\$1')
}

export function extractReleaseSummary(releaseNotes: string): string[] {
  const items: string[] = []
  let fence: string | undefined
  for (const line of releaseNotes.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/)
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1]![0]
      else if (fenceMatch[1]![0] === fence) fence = undefined
      continue
    }
    if (fence) continue
    const bullet = line.match(/^[-*] +(.+)$/)
    if (!bullet) continue
    const text = bullet[1]!.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/[`*_]/g, '').trim()
    if (!text) continue
    const points = [...text]
    items.push(points.length > 160 ? points.slice(0, 159).join('') + '…' : text)
    if (items.length === 5) break
  }
  if (items.length === 0) throw new Error('当前版本的中文发布说明没有可用的用户改动条目')
  return items
}

export function updateReadmeBlock(readme: string, metadata: CiBuildMetadata, version: string, releaseNotes: string): string {
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('package.json 版本无效')
  const eol = readme.includes('\r\n') ? '\r\n' : '\n'
  const runUrl = `https://github.com/${metadata.repository}/actions/runs/${metadata.runId}`
  const block = [
    START, '## 最新验证构建', '',
    `源码版本：**${version}**；分支：\`${metadata.branch}\`；提交：[${metadata.sourceSha.slice(0, 7)}](https://github.com/${metadata.repository}/commit/${metadata.sourceSha})。`, '',
    `构建时间：${metadata.buildTime}；[CI #${metadata.runId} · 第 ${metadata.runAttempt} 次运行](${runUrl}/attempts/${metadata.runAttempt})。`, '',
    '| 平台 | 验证构建下载 |', '| --- | --- |',
    ...PLATFORMS.map(platform => `| ${PLATFORM_NAMES[platform]} | [下载 Artifact](${metadata.artifacts.find(item => item.platform === platform)!.url}) |`), '',
    '本版用户改动：', '',
    ...extractReleaseSummary(releaseNotes).map(item => `- ${escapeMarkdown(item)}`), '',
    `下载 Artifact 需要登录 GitHub。Artifact 保留期为 **30 天**，到期后下载链接可能失效。此处为 CI 验证构建；正式版本及长期下载请查看 [GitHub Releases](https://github.com/${metadata.repository}/releases/latest)。`,
    END,
  ].join(eol)
  const start = readme.indexOf(START)
  const end = readme.indexOf(END)
  if (start < 0 && end < 0) {
    const heading = /^## Current release\r?$/m.exec(readme)
    if (!heading) throw new Error('README 缺少托管区块及 Current release 插入位置')
    return readme.slice(0, heading.index) + block + eol + eol + readme.slice(heading.index)
  }
  if (start < 0 || end < start || readme.indexOf(START, start + START.length) >= 0 || readme.indexOf(END, end + END.length) >= 0) {
    throw new Error('README 托管区块标记缺失、重复或顺序错误')
  }
  return readme.slice(0, start) + block + readme.slice(end + END.length)
}

/** 保留清单原始排版、原因和其他文件哈希，只替换 README 的唯一 64 位哈希。 */
export function updateReadmeManifest(manifestSource: string, readme: string): string {
  const manifest = object(JSON.parse(manifestSource), 'Craft 清单')
  const entries = ['modified', 'mkOnly'].flatMap(section => {
    const records = manifest[section]
    return records && typeof records === 'object' && Object.hasOwn(records, 'README.md')
      ? [object((records as Record<string, unknown>)['README.md'], 'README 清单条目')]
      : []
  })
  if (entries.length !== 1 || typeof entries[0]!.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(entries[0]!.sha256)) {
    throw new Error('Craft source-overrides 必须有且仅有一个有效的 README.md 登记')
  }
  const matches = [...manifestSource.matchAll(/("README\.md"\s*:\s*\{(?:[^{}"]|"(?:\\.|[^"\\])*")*?"sha256"\s*:\s*")([a-fA-F0-9]{64})(")/g)]
  if (matches.length !== 1) throw new Error('无法唯一定位 README.md 的原始哈希位置')
  const match = matches[0]!
  const offset = match.index! + match[1]!.length
  const hash = createHash('sha256').update(readme.replaceAll('\r\n', '\n')).digest('hex')
  return manifestSource.slice(0, offset) + hash + manifestSource.slice(offset + match[2]!.length)
}

export function updateCiReadme(repoRoot: string, input: unknown): string[] {
  // 所有校验和内容生成先完成，缺平台、错误说明或清单均不能留下部分文档更新。
  const metadata = validateMetadata(input)
  const packageJson = object(JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')), 'package.json')
  const version = packageJson.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('package.json 版本无效')
  const readmePath = join(repoRoot, 'README.md')
  const manifestPath = join(repoRoot, 'scripts/craft-source-overrides.json')
  const readme = readFileSync(readmePath, 'utf8')
  const manifest = readFileSync(manifestPath, 'utf8')
  const releaseNotes = readFileSync(join(repoRoot, 'apps/electron/resources/release-notes', `${version}.md`), 'utf8')
  const nextReadme = updateReadmeBlock(readme, metadata, version, releaseNotes)
  const nextManifest = updateReadmeManifest(manifest, nextReadme)
  const changed: string[] = []
  if (nextReadme !== readme) { writeFileSync(readmePath, nextReadme); changed.push('README.md') }
  if (nextManifest !== manifest) { writeFileSync(manifestPath, nextManifest); changed.push('scripts/craft-source-overrides.json') }
  return changed
}

export function metadataPathFromArgs(args: string[]): string {
  if (args.length !== 2 || args[0] !== '--metadata' || !args[1] || args[1].startsWith('--')) throw new Error('用法：bun scripts/update-ci-readme.ts --metadata <成功构建元数据.json>')
  return resolve(args[1])
}

if (import.meta.main) {
  try {
    const metadata = JSON.parse(readFileSync(metadataPathFromArgs(process.argv.slice(2)), 'utf8'))
    const changed = updateCiReadme(resolve(import.meta.dir, '..'), metadata)
    console.log(changed.length ? `已更新：${changed.join('、')}` : '最新验证构建记录未变化')
  } catch (error) {
    console.error(`更新 CI 构建说明失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

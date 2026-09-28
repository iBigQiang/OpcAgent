#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export interface GitHubArtifact {
  id: number
  name: string
  expired: boolean
}

const platforms = [
  ['windows-x64', 'win-x64'],
  ['macos-arm64', 'mac-arm64'],
  ['linux-x64', 'linux-x64'],
] as const

export interface CiBuildMetadata {
  status: 'success'
  repository: string
  branch: string
  sourceSha: string
  runId: number
  runAttempt: number
  buildTime: string
  artifacts: Array<{ platform: typeof platforms[number][0]; id: number; name: string }>
}

type FetchArtifacts = (url: string, init: RequestInit) => Promise<Response>

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim()
  if (!value) throw new Error(`缺少环境变量 ${key}`)
  return value
}

function positiveInteger(value: string, name: string): number {
  const number = Number(value)
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number)) {
    throw new Error(`${name} 必须为安全正整数`)
  }
  return number
}

export function selectBuildArtifacts(
  artifacts: GitHubArtifact[],
  sourceSha: string,
  runAttempt: number,
): CiBuildMetadata['artifacts'] {
  const selected = platforms.map(([platform, suffix]) => {
    const name = `ci-${suffix}-${sourceSha}-attempt-${runAttempt}`
    const matches = artifacts.filter(artifact => artifact.name === name)
    if (matches.length !== 1) {
      const hint = matches.length === 0 ? '。请在 GitHub Actions 选择 Re-run all jobs（重新运行所有作业）。' : ''
      throw new Error(`${platform} 的当前构建制品必须恰好有一项，实际为 ${matches.length} 项${hint}`)
    }
    const artifact = matches[0]!
    if (artifact.expired !== false) throw new Error(`${platform} 的当前构建制品已过期或缺少有效期状态`)
    if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0) throw new Error(`${platform} 的制品 ID 必须为安全正整数`)
    return { platform, id: artifact.id, name }
  })
  if (new Set(selected.map(artifact => artifact.id)).size !== selected.length) {
    throw new Error('三平台的制品 ID 不能重复')
  }
  return selected
}

export async function collectBuildMetadata(
  env: NodeJS.ProcessEnv = process.env,
  fetchArtifacts: FetchArtifacts = fetch,
): Promise<CiBuildMetadata> {
  const repository = required(env, 'GITHUB_REPOSITORY')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY 必须为 owner/repo 格式')
  const branch = required(env, 'GITHUB_REF_NAME')
  const sourceSha = required(env, 'GITHUB_SHA')
  if (!/^[a-fA-F0-9]{40}$/.test(sourceSha)) throw new Error('GITHUB_SHA 必须为完整的 40 位提交哈希')
  const runId = positiveInteger(required(env, 'GITHUB_RUN_ID'), 'GITHUB_RUN_ID')
  const runAttempt = positiveInteger(required(env, 'GITHUB_RUN_ATTEMPT'), 'GITHUB_RUN_ATTEMPT')
  const token = required(env, 'GH_TOKEN')
  const artifacts: GitHubArtifact[] = []

  for (let page = 1; ; page++) {
    let response: Response
    try {
      response = await fetchArtifacts(`https://api.github.com/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })
    } catch {
      // 不传播可能含鉴权请求信息的底层异常。
      throw new Error('读取 GitHub 制品列表失败：网络请求异常')
    }
    if (!response.ok) throw new Error(`读取 GitHub 制品列表失败：HTTP ${response.status}`)
    let data: { total_count: number; artifacts: GitHubArtifact[] }
    try {
      data = await response.json()
    } catch {
      throw new Error('GitHub 制品列表不是有效 JSON')
    }
    if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 0
      || !Array.isArray(data.artifacts) || data.artifacts.some(artifact => !artifact || typeof artifact.name !== 'string')) {
      throw new Error('GitHub 制品列表格式无效')
    }
    artifacts.push(...data.artifacts)
    if (artifacts.length >= data.total_count) break
    if (data.artifacts.length === 0) throw new Error('GitHub 制品分页不完整')
  }

  return {
    status: 'success', repository, branch, sourceSha, runId, runAttempt,
    buildTime: new Date().toISOString(),
    artifacts: selectBuildArtifacts(artifacts, sourceSha, runAttempt),
  }
}

export async function writeBuildMetadata(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  fetchArtifacts: FetchArtifacts = fetch,
): Promise<CiBuildMetadata> {
  if (args.length !== 2 || args[0] !== '--output' || !args[1]?.trim()) {
    throw new Error('用法：bun scripts/collect-ci-build-metadata.ts --output <JSON文件路径>')
  }
  const metadata = await collectBuildMetadata(env, fetchArtifacts)
  const outputPath = resolve(args[1])
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8')
  return metadata
}

if (import.meta.main) {
  try {
    await writeBuildMetadata(process.argv.slice(2))
    console.log('已生成当前构建的三平台制品元数据。')
  } catch (error) {
    console.error(error instanceof Error ? error.message : '收集构建制品元数据失败')
    process.exitCode = 1
  }
}

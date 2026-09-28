import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectBuildMetadata, selectBuildArtifacts, writeBuildMetadata, type GitHubArtifact } from './collect-ci-build-metadata'

const sourceSha = 'a'.repeat(40)
const environment = {
  GITHUB_REPOSITORY: 'example/agent',
  GITHUB_REF_NAME: 'main',
  GITHUB_SHA: sourceSha,
  GITHUB_RUN_ID: '123456',
  GITHUB_RUN_ATTEMPT: '2',
  GH_TOKEN: 'ghs_ci_metadata_test_secret',
}

function currentArtifacts(): GitHubArtifact[] {
  return ['win-x64', 'mac-arm64', 'linux-x64'].map((platform, index) => ({
    id: index + 1,
    name: `ci-${platform}-${sourceSha}-attempt-2`,
    expired: false,
  }))
}

function response(artifacts = currentArtifacts(), totalCount = artifacts.length): Response {
  return Response.json({ total_count: totalCount, artifacts })
}

describe('CI 制品选择', () => {
  it('严格匹配当前 SHA 和重跑次数，并忽略无关或旧制品', () => {
    const artifacts = currentArtifacts()
    const selected = selectBuildArtifacts([
      ...artifacts,
      { id: 4, name: artifacts[0]!.name.replace('attempt-2', 'attempt-1'), expired: true },
      { id: 5, name: artifacts[1]!.name.replace(sourceSha, 'b'.repeat(40)), expired: false },
      { id: 6, name: `${artifacts[2]!.name}-extra`, expired: false },
    ], sourceSha, 2)
    expect(selected.map(artifact => artifact.platform)).toEqual(['windows-x64', 'macos-arm64', 'linux-x64'])
    expect(selected.map(artifact => artifact.id)).toEqual([1, 2, 3])
    expect(selected.map(artifact => artifact.name)).toEqual(artifacts.map(artifact => artifact.name))
  })

  it('缺失任一平台时拒绝，不以旧重跑制品补齐', () => {
    const artifacts = currentArtifacts()
    artifacts[2]!.name = artifacts[2]!.name.replace('attempt-2', 'attempt-1')
    expect(() => selectBuildArtifacts(artifacts, sourceSha, 2)).toThrow('linux-x64 的当前构建制品必须恰好有一项，实际为 0 项')
    expect(() => selectBuildArtifacts(artifacts, sourceSha, 2)).toThrow('请在 GitHub Actions 选择 Re-run all jobs（重新运行所有作业）。')
  })

  it('同名目标重复时拒绝，即使其中一项已过期', () => {
    const artifacts = currentArtifacts()
    artifacts.push({ ...artifacts[0]!, id: 4, expired: true })
    expect(() => selectBuildArtifacts(artifacts, sourceSha, 2)).toThrow('实际为 2 项')
  })

  it('目标制品过期时拒绝', () => {
    const artifacts = currentArtifacts()
    artifacts[1]!.expired = true
    expect(() => selectBuildArtifacts(artifacts, sourceSha, 2)).toThrow('macos-arm64 的当前构建制品已过期')
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('无效制品 ID %s 被拒绝', id => {
    const artifacts = currentArtifacts()
    artifacts[0]!.id = id
    expect(() => selectBuildArtifacts(artifacts, sourceSha, 2)).toThrow('ID 必须为安全正整数')
  })

  it('不同平台的制品 ID 重复时拒绝', () => {
    const artifacts = currentArtifacts()
    artifacts[1]!.id = artifacts[0]!.id
    expect(() => selectBuildArtifacts(artifacts, sourceSha, 2)).toThrow('三平台的制品 ID 不能重复')
  })
})

describe('GitHub 制品收集', () => {
  it('读取所有分页，携带鉴权，并输出可核对的当前运行元数据', async () => {
    const urls: string[] = []
    const headers: Headers[] = []
    const unrelated = Array.from({ length: 100 }, (_, index) => ({ id: index + 10, name: `unrelated-${index}`, expired: false }))
    const started = Date.now()
    const metadata = await collectBuildMetadata(environment, async (url, init) => {
      urls.push(url)
      headers.push(new Headers(init.headers))
      return urls.length === 1 ? response(unrelated, 103) : response(currentArtifacts(), 103)
    })
    expect(urls).toEqual([1, 2].map(page => `https://api.github.com/repos/example/agent/actions/runs/123456/artifacts?per_page=100&page=${page}`))
    expect(headers.every(header => header.get('Authorization') === `Bearer ${environment.GH_TOKEN}`)).toBe(true)
    expect(metadata).toMatchObject({
      status: 'success', repository: 'example/agent', branch: 'main', sourceSha,
      runId: 123456, runAttempt: 2,
    })
    expect(metadata.artifacts).toHaveLength(3)
    expect(new Date(metadata.buildTime).toISOString()).toBe(metadata.buildTime)
    expect(Date.parse(metadata.buildTime)).toBeGreaterThanOrEqual(started)
    expect(Date.parse(metadata.buildTime)).toBeLessThanOrEqual(Date.now())
    expect(JSON.stringify(metadata)).not.toContain(environment.GH_TOKEN)
  })

  it.each([401, 403, 500])('API 返回 HTTP %s 时拒绝', async status => {
    await expect(collectBuildMetadata(environment, async () => new Response(environment.GH_TOKEN, { status })))
      .rejects.toThrow(`读取 GitHub 制品列表失败：HTTP ${status}`)
  })

  it('网络异常不会把请求中的令牌带入错误消息', async () => {
    await expect(collectBuildMetadata(environment, async () => { throw new Error(environment.GH_TOKEN) }))
      .rejects.toThrow('读取 GitHub 制品列表失败：网络请求异常')
  })

  it('后续分页失败时拒绝已有的完整三平台结果', async () => {
    let page = 0
    await expect(collectBuildMetadata(environment, async () => ++page === 1 ? response(currentArtifacts(), 4) : new Response(null, { status: 500 })))
      .rejects.toThrow('HTTP 500')
    expect(page).toBe(2)
  })

  it('分页尚未完整却返回空页时拒绝', async () => {
    await expect(collectBuildMetadata(environment, async () => response([], 1))).rejects.toThrow('GitHub 制品分页不完整')
  })

  it('无法解析的 API 响应不会成为成功元数据', async () => {
    await expect(collectBuildMetadata(environment, async () => new Response('无效 JSON'))).rejects.toThrow('GitHub 制品列表不是有效 JSON')
    await expect(collectBuildMetadata(environment, async () => Response.json({ artifacts: currentArtifacts() }))).rejects.toThrow('GitHub 制品列表格式无效')
  })

  it.each([
    { GITHUB_SHA: 'short' },
    { GITHUB_REPOSITORY: 'owner/repo/extra' },
    { GITHUB_RUN_ID: '1.5' },
    { GITHUB_RUN_ATTEMPT: '0' },
    { GH_TOKEN: '' },
  ])('环境无效时不发起请求：%j', async invalid => {
    let calls = 0
    await expect(collectBuildMetadata({ ...environment, ...invalid }, async () => { calls++; return response() })).rejects.toThrow()
    expect(calls).toBe(0)
  })
})

describe('CI 制品元数据文件', () => {
  it('成功时生成 JSON，失败时保留原文件并且不产生成功元数据', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'opc-ci-metadata-'))
    const outputPath = join(directory, 'metadata.json')
    try {
      const args = ['--output', outputPath]
      await expect(writeBuildMetadata(args, environment, async () => response([]))).rejects.toThrow('实际为 0 项')
      expect(existsSync(outputPath)).toBe(false)
      const metadata = await writeBuildMetadata(args, environment, async () => response())
      const original = readFileSync(outputPath, 'utf-8')
      expect(JSON.parse(original)).toEqual(metadata)
      await expect(writeBuildMetadata(args, environment, async () => new Response(null, { status: 403 }))).rejects.toThrow('HTTP 403')
      expect(readFileSync(outputPath, 'utf-8')).toBe(original)
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath)
      rmdirSync(directory)
    }
  })

  it('CLI 缺少参数时退出失败，并提供中文用法', () => {
    const directory = mkdtempSync(join(tmpdir(), 'opc-ci-metadata-cli-'))
    try {
      const result = Bun.spawnSync([process.execPath, join(import.meta.dir, 'collect-ci-build-metadata.ts')], {
        env: { ...process.env, ...environment, CONFIG_DIR: directory },
        stdout: 'pipe', stderr: 'pipe',
      })
      expect(result.exitCode).toBe(1)
      expect(result.stderr.toString()).toContain('用法：')
      expect(`${result.stdout}${result.stderr}`).not.toContain(environment.GH_TOKEN)
    } finally {
      const logsDirectory = join(directory, 'logs')
      if (existsSync(logsDirectory)) rmdirSync(logsDirectory)
      rmdirSync(directory)
    }
  })
})

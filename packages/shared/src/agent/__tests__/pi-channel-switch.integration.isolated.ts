import { expect, test } from 'bun:test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AgentEvent } from '@opcagent/core/types'

function streamResponse(content: string, toolCall = false): Response {
  const delta = toolCall
    ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-session-proof', type: 'function', function: { name: 'mcp__session__get_session_info', arguments: '{}' } }] }
    : { role: 'assistant', content }
  const chunks = [
    { id: 'switch-proof', object: 'chat.completion.chunk', choices: [{ index: 0, delta }] },
    { id: 'switch-proof', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: toolCall ? 'tool_calls' : 'stop' }] },
  ]
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  })
}

test('真实 Pi 子进程在同名模型 A→B→A 后保留历史、工具与各自认证', async () => {
  const root = mkdtempSync(join(tmpdir(), 'opcagent-channel-switch-'))
  const configDir = join(root, 'config')
  const workspaceRoot = join(root, 'workspace')
  mkdirSync(configDir)
  mkdirSync(workspaceRoot)
  const defaultsPath = join(configDir, 'config-defaults.json')
  copyFileSync(resolve(import.meta.dir, '../../../../../apps/electron/resources/config-defaults.json'), defaultsPath)
  const previousConfig = process.env.CONFIG_DIR
  process.env.CONFIG_DIR = configDir

  // 此文件由现有 runner 独立执行，配置与假凭据不会进入真实用户目录。
  const { CONFIG_DIR } = await import('../../config/paths.ts')
  expect(CONFIG_DIR).toBe(configDir)
  const { getCredentialManager } = await import('../../credentials/index.ts')
  const { PiAgent } = await import('../pi-agent.ts')
  const { registerSessionScopedToolCallbacks, unregisterSessionScopedToolCallbacks } = await import('../session-scoped-tool-callback-registry.ts')
  const credentials = getCredentialManager()
  await credentials.setLlmApiKey('test-channel-a', 'test-key-a')
  await credentials.setLlmApiKey('test-channel-b', 'test-key-b')

  const requests: Array<{ channel: string; authorization: string | null; body: Record<string, unknown> }> = []
  const toolRequestedByChannel = new Set<string>()
  let executedToolCount = 0
  function endpoint(channel: string) {
    return Bun.serve({
      hostname: '127.0.0.1', port: 0,
      async fetch(request) {
        if (!new URL(request.url).pathname.endsWith('/chat/completions')) return new Response('未找到', { status: 404 })
        requests.push({ channel, authorization: request.headers.get('authorization'), body: await request.json() as Record<string, unknown> })
        if (!toolRequestedByChannel.has(channel)) {
          toolRequestedByChannel.add(channel)
          return streamResponse('', true)
        }
        return streamResponse(channel === 'a' ? '渠道A已收到上下文。' : '渠道B已接续上下文。')
      },
    })
  }
  const endpointA = endpoint('a')
  const endpointB = endpoint('b')
  const sessionId = 'channel-switch-session'
  let currentAgent: InstanceType<typeof PiAgent> | undefined
  const sessionPath = join(workspaceRoot, 'sessions', sessionId)

  async function continueOn(channel: 'a' | 'b', prompt: string): Promise<AgentEvent[]> {
    if (currentAgent) await currentAgent.disposeForRestart()
    registerSessionScopedToolCallbacks(sessionId, {
      getSessionInfoFn: () => {
        executedToolCount += 1
        return { id: sessionId, name: '必须保留的工具结果', permissionMode: 'allow-all', createdAt: 1, isActive: true }
      },
    })
    currentAgent = new PiAgent({
      provider: 'pi', providerType: 'pi_compat', authType: 'api_key',
      connectionSlug: `test-channel-${channel}`, model: 'same-model-id',
      workspace: { id: 'workspace-proof', name: '验证工作区', slug: 'proof', rootPath: workspaceRoot, createdAt: 1 },
      session: { id: sessionId, workspaceRootPath: workspaceRoot, createdAt: 1, lastUsedAt: 1, permissionMode: 'allow-all' },
      isHeadless: true, skipConfigWatcher: true,
      runtime: {
        paths: { node: process.execPath, piServer: resolve(import.meta.dir, '../../../../pi-agent-server/src/index.ts') },
        piAuthProvider: 'openai',
        baseUrl: `http://127.0.0.1:${channel === 'a' ? endpointA.port : endpointB.port}/v1`,
        customEndpoint: { api: 'openai-completions' },
        customModels: [{ id: 'same-model-id', contextWindow: 32768 }],
      },
    })
    const events: AgentEvent[] = []
    for await (const event of currentAgent.chat(prompt)) events.push(event)
    expect(events.filter(event => event.type === 'error' || event.type === 'typed_error')).toEqual([])
    expect(events.at(-1)?.type).toBe('complete')
    return events
  }

  try {
    const first = await continueOn('a', '记住验证口令：山间松风。先读取会话信息。')
    expect(first.some(event => event.type === 'tool_result')).toBe(true)
    const second = await continueOn('b', '继续刚才的任务，保留口令和工具结果。')
    expect(second.some(event => event.type === 'tool_result')).toBe(true)
    const requestB = requests.find(request => request.channel === 'b')!
    expect(requestB.authorization).toBe('Bearer test-key-b')
    expect(requestB.body.model).toBe('same-model-id')
    expect(JSON.stringify(requestB.body.messages)).toContain('山间松风')
    expect(JSON.stringify(requestB.body.messages)).toContain('必须保留的工具结果')
    expect(JSON.stringify(requestB.body.tools)).toContain('mcp__session__get_session_info')
    expect(JSON.stringify(requestB.body)).not.toContain('opcConnectionSlug')

    await continueOn('a', '再次回到渠道A，接着渠道B的内容继续。')
    const last = requests.at(-1)!
    expect(last.channel).toBe('a')
    expect(last.authorization).toBe('Bearer test-key-a')
    expect(JSON.stringify(last.body.messages)).toContain('渠道B已接续上下文')
    expect(JSON.stringify(last.body.messages)).toContain('必须保留的工具结果')
    expect(requests).toHaveLength(5)
    expect(executedToolCount).toBe(2)
    expect(requests.filter(request => request.channel === 'a').every(request => request.authorization === 'Bearer test-key-a')).toBe(true)

    await currentAgent!.disposeForRestart()
    currentAgent = undefined
    const sessionFiles = readdirSync(join(sessionPath, '.pi-sessions')).filter(file => file.endsWith('.jsonl'))
    expect(sessionFiles).toHaveLength(1)
    const sdkFile = join(sessionPath, '.pi-sessions', sessionFiles[0]!)
    const stored = readFileSync(sdkFile, 'utf8')
    expect(stored).toContain('test-channel-a')
    expect(stored).toContain('test-channel-b')
    expect(stored).not.toContain('test-key-a')
    expect(stored).not.toContain('test-key-b')
    // 只删除当前测试已确认的单个 SDK 文件，不递归清理目录。
    unlinkSync(sdkFile)
  } finally {
    await currentAgent?.disposeForRestart()
    endpointA.stop(true)
    endpointB.stop(true)
    unregisterSessionScopedToolCallbacks(sessionId)
    if (previousConfig === undefined) delete process.env.CONFIG_DIR
    else process.env.CONFIG_DIR = previousConfig
    // 清理本测试创建的明确文件；失败时保留额外诊断文件供排查。
    if (existsSync(defaultsPath)) unlinkSync(defaultsPath)
    const credentialFile = join(configDir, 'credentials.enc')
    if (existsSync(credentialFile)) unlinkSync(credentialFile)
    const settingsFile = join(sessionPath, '.pi-agent', 'settings.json')
    if (existsSync(settingsFile)) unlinkSync(settingsFile)
    // rmdirSync 只接受空目录，不能吞掉未知文件或递归删除。
    const removeEmpty = (path: string) => { if (existsSync(path) && readdirSync(path).length === 0) rmdirSync(path) }
    removeEmpty(join(sessionPath, '.pi-sessions'))
    removeEmpty(join(sessionPath, '.pi-agent'))
    removeEmpty(join(sessionPath, 'plans'))
    removeEmpty(join(sessionPath, 'data'))
    removeEmpty(sessionPath)
    removeEmpty(join(workspaceRoot, 'sessions'))
    removeEmpty(workspaceRoot)
    removeEmpty(join(configDir, 'logs'))
    removeEmpty(configDir)
    removeEmpty(root)
  }
}, 60_000)

import { expect, test } from 'bun:test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LlmConnection } from '@opcagent/shared/config'
import type { SessionEvent } from '@opcagent/shared/protocol'

type WireMessage = { role: string; content: unknown; tool_calls?: unknown[] }
type RequestRecord = { channel: string; key: string | null; model: string; messages: WireMessage[]; tools: unknown[] }

function streamReply(text: string, toolId?: string): Response {
  const delta = toolId
    ? { role: 'assistant', tool_calls: [{ index: 0, id: toolId, type: 'function', function: { name: 'mcp__session__get_session_info', arguments: '{}' } }] }
    : { role: 'assistant', content: text }
  return new Response([
    { id: 'session-integration', object: 'chat.completion.chunk', choices: [{ index: 0, delta }] },
    { id: 'session-integration', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: toolId ? 'tool_calls' : 'stop' }] },
  ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
}

test('真实会话入口贯通首次改选、A→B→A、重启、分支、远端失败与删除原渠道续聊', async () => {
  const root = mkdtempSync(join(tmpdir(), 'opc-session-route-e2e-'))
  const configDir = join(root, 'config')
  const workspaceRoot = join(root, 'workspace')
  mkdirSync(configDir)
  mkdirSync(workspaceRoot)
  const repoRoot = resolve(import.meta.dir, '../../../..')
  const defaultsPath = join(configDir, 'config-defaults.json')
  copyFileSync(join(repoRoot, 'apps/electron/resources/config-defaults.json'), defaultsPath)
  const previousConfig = process.env.CONFIG_DIR
  const previousBun = process.env.OPCAGENT_BUN
  process.env.CONFIG_DIR = configDir
  process.env.OPCAGENT_BUN = process.execPath
  const { CONFIG_DIR } = await import('@opcagent/shared/config/paths')
  expect(CONFIG_DIR).toBe(configDir)
  const { SessionManager, setSessionPlatform, loadPiTurnAnchors } = await import('./SessionManager')
  const { getCredentialManager } = await import('@opcagent/shared/credentials')
  const { loadSession, sessionPersistenceQueue } = await import('@opcagent/shared/sessions')
  const logger = { info() {}, warn() {}, error: console.error, debug() {} }
  setSessionPlatform({ appRootPath: repoRoot, resourcesPath: join(repoRoot, 'apps/electron/resources'), isPackaged: false,
    appVersion: 'test', isDebugMode: false, logger, imageProcessor: { getMetadata: async () => null, process: async () => Buffer.alloc(0) } })
  // 使用应用同样的后端工厂与当前源代码构建产物，不替换 agent 或恢复函数。
  const build = await Bun.build({ entrypoints: [join(repoRoot, 'packages/pi-agent-server/src/index.ts')],
    outdir: join(repoRoot, 'packages/pi-agent-server/dist'), target: 'bun', format: 'esm', external: ['koffi'] })
  expect(build.success).toBe(true)

  const requests: RequestRecord[] = []
  let failChannel: string | undefined
  const toolTurns = new Set<string>()
  const serve = (channel: string) => Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as Omit<RequestRecord, 'channel' | 'key'>
    requests.push({ ...body, channel, key: request.headers.get('authorization') })
    if (failChannel === channel) return Response.json({ error: { message: '模拟目标渠道认证失败', type: 'authentication_error' } }, { status: 401 })
    const user = JSON.stringify(body.messages.findLast(item => item.role === 'user')?.content)
    const marker = user.match(/GOAL_[A-Z_]+/)?.[0] ?? 'UNKNOWN'
    if (user.includes('使用工具') && !toolTurns.has(marker)) {
      toolTurns.add(marker)
      return streamReply('', `call_${marker}`)
    }
    return streamReply(`渠道${channel}完成 ${marker}`)
  } })
  const serverA = serve('a')
  const serverB = serve('b')
  const connections: LlmConnection[] = [serverA, serverB].map((server, index) => ({
    slug: index === 0 ? 'a' : 'b', name: index === 0 ? '渠道A' : '渠道B', providerType: 'pi_compat', authType: 'api_key',
    piAuthProvider: 'openai', baseUrl: `http://127.0.0.1:${server.port}/v1`, customEndpoint: { api: 'openai-completions' },
    models: ['same-model', 'second-model'], defaultModel: 'same-model', createdAt: 1,
  }))
  const configPath = join(configDir, 'config.json')
  const workspaceConfigPath = join(workspaceRoot, 'config.json')
  const writeConnections = (items = connections) => writeFileSync(configPath, JSON.stringify({
    workspaces: [{ id: 'ws', slug: 'ws', name: '隔离验证工作区', rootPath: workspaceRoot, createdAt: 1 }],
    activeWorkspaceId: 'ws', activeSessionId: null, llmConnections: items, defaultLlmConnection: 'a',
  }))
  writeConnections()
  const sourcesDir = join(workspaceRoot, 'sources')
  mkdirSync(sourcesDir)
  for (const slug of ['approved-api', 'unselected-api']) {
    mkdirSync(join(sourcesDir, slug))
    writeFileSync(join(sourcesDir, slug, 'config.json'), JSON.stringify({ id: slug, slug, name: slug, provider: 'test', enabled: true,
      type: 'api', api: { baseUrl: `http://127.0.0.1:${serverA.port}/source/`, authType: 'none' } }))
  }
  writeFileSync(workspaceConfigPath, JSON.stringify({ id: 'ws', slug: 'ws', name: '隔离验证工作区', defaults: {
    defaultLlmConnection: 'a', model: 'same-model', permissionMode: 'safe', workingDirectory: workspaceRoot, enabledSourceSlugs: ['approved-api'],
  }, createdAt: 1, updatedAt: 1 }))
  await getCredentialManager().setLlmApiKey('a', 'fake-e2e-key-a')
  await getCredentialManager().setLlmApiKey('b', 'fake-e2e-key-b')
  const events: SessionEvent[] = []
  let manager = new SessionManager()
  manager.setEventSink((_channel, _target, event) => events.push(event as SessionEvent))
  const sessionIds: string[] = []
  const close = async () => {
    // 等待真实子进程退出，模拟重启只读取已经完成落盘的历史。
    const sessions = (manager as unknown as { sessions: Map<string, { agent: { disposeForRestart?: () => Promise<void> } | null }> }).sessions
    for (const [id, managed] of sessions) {
      await manager.flushSession(id)
      await managed.agent?.disposeForRestart?.()
    }
    manager.cleanup()
  }
  const restart = async () => {
    await close()
    manager = new SessionManager()
    manager.setEventSink((_channel, _target, event) => events.push(event as SessionEvent))
    await manager.initialize()
  }
  const send = async (id: string, message: string, expectError = false) => {
    const before = events.length
    const requestStart = requests.length
    await manager.sendMessage(id, message)
    const errors = events.slice(before).filter(event => event.type === 'error' || event.type === 'typed_error')
    if (expectError) expect(errors.length).toBeGreaterThan(0)
    else expect(errors).toEqual([])
    expect(requests.length).toBeGreaterThan(requestStart)
    return requests.slice(requestStart)
  }
  try {
    await manager.initialize()
    const initial = await manager.createSession('ws', { name: '工具返回的会话名称', permissionMode: 'safe' })
    sessionIds.push(initial.id)
    await manager.updateSessionModel(initial.id, 'ws', 'same-model', 'b')
    const first = await send(initial.id, 'GOAL_FIRST 记住：山间松风。使用工具读取会话信息。')
    expect(first.every(request => request.channel === 'b')).toBe(true)
    expect(first.at(-1)?.messages.some(message => message.role === 'tool')).toBe(true)
    expect(JSON.stringify(first.at(-1)?.messages)).toContain('工具返回的会话名称')
    expect(JSON.stringify(first[0]?.tools)).toContain('api_approved-api')
    expect(JSON.stringify(first[0]?.tools)).not.toContain('api_unselected-api')
    expect(requests.some(request => request.channel === 'a')).toBe(false)
    const sdkId = loadSession(workspaceRoot, initial.id)!.sdkSessionId
    expect(sdkId).toBeTruthy()

    await manager.updateSessionModel(initial.id, 'ws', 'same-model', 'a')
    const onA = await send(initial.id, 'GOAL_SECOND 继续前文。')
    expect(onA[0]?.channel).toBe('a')
    expect(JSON.stringify(onA[0]?.messages)).toContain('山间松风')
    expect(JSON.stringify(onA[0]?.messages)).toContain('工具返回的会话名称')
    await manager.updateSessionModel(initial.id, 'ws', 'second-model', 'b')
    const onB = await send(initial.id, 'GOAL_THIRD 沿着前文继续，使用工具确认会话。')
    expect(onB.every(request => request.channel === 'b' && request.model === 'second-model')).toBe(true)
    expect(JSON.stringify(onB[0]?.tools)).toContain('mcp__session__get_session_info')
    expect(JSON.stringify(onB[0]?.tools)).toContain('api_approved-api')
    expect(JSON.stringify(onB[0]?.tools)).not.toContain('api_unselected-api')
    const branchAnchor = (await manager.getSession(initial.id))!.messages.findLast(message => message.role === 'assistant')!.id
    await manager.updateSessionModel(initial.id, 'ws', 'same-model', 'a')
    await send(initial.id, 'GOAL_PARENT_LATER 这句在分支切点之后。')
    await restart()
    expect(await manager.getSession(initial.id)).toMatchObject({ id: initial.id, llmConnection: 'a', model: 'same-model', permissionMode: 'safe', workingDirectory: workspaceRoot, enabledSourceSlugs: ['approved-api'] })
    const afterRestart = await send(initial.id, 'GOAL_RESTART 重启后继续。')
    expect(JSON.stringify(afterRestart[0]?.messages)).toContain('GOAL_THIRD')
    expect(loadSession(workspaceRoot, initial.id)!.sdkSessionId).toBe(sdkId)

    // 用全新服务进程读盘并续聊，不能依赖当前进程的缓存或持久化队列状态。
    await close()
    const processRequestStart = requests.length
    const script = `
      import { SessionManager, setSessionPlatform } from ${JSON.stringify(pathToFileURL(join(import.meta.dir, 'SessionManager.ts')).href)};
      const log = { info() {}, warn() {}, error() {}, debug() {} };
      setSessionPlatform({ appRootPath: ${JSON.stringify(repoRoot)}, resourcesPath: ${JSON.stringify(join(repoRoot, 'apps/electron/resources'))}, isPackaged: false,
        appVersion: 'test', isDebugMode: false, logger: log, imageProcessor: { getMetadata: async () => null, process: async () => Buffer.alloc(0) } });
      const manager = new SessionManager();
      const errors = [];
      manager.setEventSink((_channel, _target, event) => { if (event?.type === 'error' || event?.type === 'typed_error') errors.push(event); });
      await manager.initialize();
      await manager.sendMessage(${JSON.stringify(initial.id)}, 'GOAL_PROCESS_RESTART 全新进程继续原任务。');
      const session = await manager.getSession(${JSON.stringify(initial.id)});
      console.log('SESSION_RESTART_PROOF ' + JSON.stringify({ model: session.model, connection: session.llmConnection, errors }));
      for (const managed of manager.sessions.values()) { await manager.flushSession(managed.id); await managed.agent?.disposeForRestart?.(); }
      manager.cleanup();
    `
    const child = Bun.spawn([process.execPath, '--eval', script], { cwd: repoRoot, env: process.env, stdout: 'pipe', stderr: 'pipe' })
    const [childOutput, childError, childCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(childCode, childError).toBe(0)
    const proof = childOutput.split('\n').find(line => line.startsWith('SESSION_RESTART_PROOF '))!
    expect(JSON.parse(proof.slice('SESSION_RESTART_PROOF '.length))).toEqual({ model: 'same-model', connection: 'a', errors: [] })
    expect(requests[processRequestStart]?.channel).toBe('a')
    expect(JSON.stringify(requests[processRequestStart]?.messages)).toContain('GOAL_THIRD')
    expect(loadSession(workspaceRoot, initial.id)!.sdkSessionId).toBe(sdkId)
    manager = new SessionManager()
    manager.setEventSink((_channel, _target, event) => events.push(event as SessionEvent))
    await manager.initialize()

    const unanchored = (await manager.getSession(initial.id))!.messages.find(message => message.role === 'user')!.id
    const sessionCount = manager.getSessions('ws').length
    await expect(manager.createSession('ws', { branchFromSessionId: initial.id, branchFromMessageId: unanchored })).rejects.toThrow('缺少可恢复的 Pi 分支切点')
    expect(manager.getSessions('ws').length).toBe(sessionCount)
    expect((await loadPiTurnAnchors(join(workspaceRoot, 'sessions', initial.id))).anchors[branchAnchor]).toBeTruthy()
    const branch = await manager.createSession('ws', { name: '验证分支', branchFromSessionId: initial.id, branchFromMessageId: branchAnchor,
      llmConnection: 'b', model: 'second-model', permissionMode: 'safe' })
    sessionIds.push(branch.id)
    const branchFirst = await send(branch.id, 'GOAL_BRANCH_FIRST 分支新增内容。')
    expect(JSON.stringify(branchFirst[0]?.messages)).toContain('GOAL_THIRD')
    expect(JSON.stringify(branchFirst[0]?.messages)).not.toContain('GOAL_PARENT_LATER')
    const diskBranch = loadSession(workspaceRoot, branch.id)!
    expect(diskBranch.workspaceRootPath).toBe(workspaceRoot)
    expect(diskBranch.agentProvider).toBe('pi')
    expect(diskBranch.messages.some(message => message.content.includes('GOAL_BRANCH_FIRST'))).toBe(true)
    await manager.updateSessionModel(branch.id, 'ws', 'same-model', 'a')
    await send(branch.id, 'GOAL_BRANCH_SECOND 分支切换渠道继续。')
    await restart()
    const branchRestored = await send(branch.id, 'GOAL_BRANCH_RESTART 恢复分支最新状态。')
    expect(JSON.stringify(branchRestored[0]?.messages)).toContain('GOAL_BRANCH_FIRST')
    expect(JSON.stringify(branchRestored[0]?.messages)).toContain('GOAL_BRANCH_SECOND')
    expect(JSON.stringify(branchRestored[0]?.messages)).not.toContain('GOAL_PARENT_LATER')

    await manager.updateSessionModel(initial.id, 'ws', 'same-model', 'b')
    failChannel = 'b'
    const failed = await send(initial.id, 'GOAL_REMOTE_ERROR 模拟远端拒绝。', true)
    expect(failed.every(request => request.channel === 'b')).toBe(true)
    expect(await manager.getSession(initial.id)).toMatchObject({ llmConnection: 'b', model: 'same-model' })
    failChannel = undefined
    await send(initial.id, 'GOAL_RETRY 在当前渠道重试。')
    writeConnections(connections.filter(connection => connection.slug === 'a'))
    await manager.updateSessionModel(initial.id, 'ws', 'same-model', 'a')
    const recovered = await send(initial.id, 'GOAL_DELETED 原渠道删除后继续。')
    expect(recovered[0]?.channel).toBe('a')
    expect(JSON.stringify(recovered[0]?.messages)).toContain('GOAL_RETRY')
    expect(JSON.stringify(recovered[0]?.messages)).toContain('山间松风')
    expect(JSON.stringify(recovered[0]?.tools)).toContain('api_approved-api')
    expect(JSON.stringify(recovered[0]?.tools)).not.toContain('api_unselected-api')
    expect(requests.every(request => request.key === `Bearer fake-e2e-key-${request.channel}`)).toBe(true)
    expect(toolTurns.size).toBe(2)
    expect(loadSession(workspaceRoot, initial.id)!.sdkSessionId).toBe(sdkId)
  } finally {
    await close()
    serverA.stop(true)
    serverB.stop(true)
    for (const id of sessionIds) {
      sessionPersistenceQueue.cancel(id)
      const sessionPath = join(workspaceRoot, 'sessions', id)
      // 只清理本测试的已知日志与配置文件；未知诊断文件留存，不递归删除。
      const sdkDir = join(sessionPath, '.pi-sessions')
      for (const file of existsSync(sdkDir) ? readdirSync(sdkDir).filter(file => file.endsWith('.jsonl')) : []) unlinkSync(join(sdkDir, file))
      for (const file of ['session.jsonl', 'session.jsonl.tmp', '.pi-agent/settings.json', 'meta/pi-turn-anchors.json']) {
        const path = join(sessionPath, file)
        if (existsSync(path)) unlinkSync(path)
      }
      const removeEmpty = (path: string) => { if (existsSync(path) && readdirSync(path).length === 0) rmdirSync(path) }
      for (const directory of ['.pi-sessions', '.pi-agent', 'meta', 'attachments', 'plans', 'long_responses', 'data', 'downloads']) removeEmpty(join(sessionPath, directory))
      removeEmpty(sessionPath)
    }
    for (const file of [defaultsPath, configPath, workspaceConfigPath, join(configDir, 'credentials.enc')]) if (existsSync(file)) unlinkSync(file)
    for (const slug of ['approved-api', 'unselected-api']) {
      const file = join(sourcesDir, slug, 'config.json')
      if (existsSync(file)) unlinkSync(file)
      if (readdirSync(join(sourcesDir, slug)).length === 0) rmdirSync(join(sourcesDir, slug))
    }
    if (readdirSync(sourcesDir).length === 0) rmdirSync(sourcesDir)
    if (previousConfig === undefined) delete process.env.CONFIG_DIR
    else process.env.CONFIG_DIR = previousConfig
    if (previousBun === undefined) delete process.env.OPCAGENT_BUN
    else process.env.OPCAGENT_BUN = previousBun
    // 剩余目录仅在为空时移除，保证失败诊断文件不会被吞掉。
    for (const path of [join(workspaceRoot, 'sessions'), workspaceRoot, join(configDir, 'logs'), configDir, root]) {
      if (existsSync(path) && readdirSync(path).length === 0) rmdirSync(path)
    }
  }
}, 120_000)

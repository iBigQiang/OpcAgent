import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LlmConnection } from '@opcagent/shared/config'

// 由项目 runner 单独执行，在导入业务模块前固定独立配置根目录。
const previousConfigDir = process.env.CONFIG_DIR
const isolatedConfigDir = mkdtempSync(join(tmpdir(), 'opc-selection-config-'))
process.env.CONFIG_DIR = isolatedConfigDir
const { getCredentialManager } = await import('@opcagent/shared/credentials')
const { loadSession, sessionPersistenceQueue } = await import('@opcagent/shared/sessions')
const { createManagedSession, SessionManager, setSessionPlatform } = await import('./SessionManager')
const configPath = join(isolatedConfigDir, 'config.json')

const connections: LlmConnection[] = [
  { slug: 'a', name: 'A', providerType: 'pi_compat', authType: 'none', baseUrl: 'http://localhost:31001', models: ['same-model', 'model-a'], defaultModel: 'same-model', createdAt: 1 },
  { slug: 'b', name: 'B', providerType: 'pi_compat', authType: 'none', baseUrl: 'http://localhost:31002', models: ['same-model', 'model-b'], defaultModel: 'same-model', createdAt: 1 },
  { slug: 'cli', name: 'CLI', providerType: 'pi_compat', platformProfile: 'anyrouter', authType: 'none', models: ['same-model', 'model-cli'], defaultModel: 'same-model', createdAt: 1 },
  { slug: 'cli-other', name: '另一 CLI', providerType: 'pi_compat', platformProfile: 'anyrouter', authType: 'none', models: ['same-model'], defaultModel: 'same-model', createdAt: 1 },
]

function writeConnections(items = connections) {
  writeFileSync(configPath, JSON.stringify({ llmConnections: items, defaultLlmConnection: 'a', workspaces: [], activeWorkspaceId: null, activeSessionId: null }))
}

function agentStub() {
  return {
    supportsBranching: true,
    isProcessing: () => false,
    redirect: () => false,
    setModel: jest.fn(),
    dispose: jest.fn(),
    disposeForRestart: jest.fn(async () => {}),
    ensureSessionReady: jest.fn(async () => ({ thinkingLevel: 'high', contextWindow: 64000 })),
  }
}

describe('会话渠道和模型原子切换', () => {
  let root: string
  let manager: InstanceType<typeof SessionManager>
  let managed: ReturnType<typeof createManagedSession>
  let oldAgent: ReturnType<typeof agentStub>
  let nextAgent: ReturnType<typeof agentStub>
  let events: Array<Record<string, unknown>>

  beforeEach(async () => {
    writeConnections()
    root = mkdtempSync(join(tmpdir(), 'opc-session-selection-'))
    manager = new SessionManager()
    events = []
    manager.setEventSink((_channel, _target, event) => { events.push(event as Record<string, unknown>) })
    managed = createManagedSession({
      id: 'selection-test', model: 'same-model', llmConnection: 'a', agentProvider: 'pi',
      sdkSessionId: 'sdk-original', connectionLocked: true, thinkingLevel: 'max',
      enabledSourceSlugs: ['approved-source'], permissionMode: 'safe', workingDirectory: root,
    }, { id: 'ws', slug: 'ws', name: '测试工作区', rootPath: root, createdAt: 1 }, { messagesLoaded: true })
    managed.messages.push({ id: 'u1', role: 'user', content: '请记住前文', timestamp: 1 })
    managed.tokenUsage.inputTokens = 123
    managed.tokenUsage.costUsd = 0.2
    managed.tokenUsage.contextWindow = 128000
    oldAgent = agentStub()
    nextAgent = agentStub()
    managed.agent = oldAgent as never
    ;(manager as any).sessions.set(managed.id, managed)
    ;(manager as any).getOrCreateAgent = async () => {
      managed.agent = nextAgent as never
      managed.sdkSessionId = 'sdk-restored'
      ;(manager as any).persistSession(managed)
      return nextAgent
    }
    await manager.flushSession(managed.id)
  })

  afterEach(async () => {
    sessionPersistenceQueue.cancel(managed.id)
    jest.restoreAllMocks()
    const sessionDir = join(root, 'sessions', managed.id)
    const sdkFile = join(sessionDir, '.pi-sessions', 'history.jsonl')
    if (existsSync(sdkFile)) unlinkSync(sdkFile)
    if (existsSync(join(sessionDir, '.pi-sessions'))) rmdirSync(join(sessionDir, '.pi-sessions'))
    const file = join(sessionDir, 'session.jsonl')
    if (existsSync(file)) unlinkSync(file)
    const tempFile = file + '.tmp'
    if (existsSync(tempFile)) unlinkSync(tempFile)
    for (const directory of ['attachments', 'plans', 'long_responses', 'data', 'downloads']) {
      const path = join(sessionDir, directory)
      if (existsSync(path)) rmdirSync(path)
    }
    rmdirSync(sessionDir)
    rmdirSync(join(root, 'sessions'))
    rmdirSync(root)
  })

  test('A→B→A：相同模型 ID 也更换实例，保留历史、工具授权和累积使用量', async () => {
    await manager.updateSessionModel(managed.id, 'ws', 'same-model', 'b')
    expect(oldAgent.setModel).not.toHaveBeenCalled()
    expect(oldAgent.disposeForRestart).toHaveBeenCalledTimes(1)
    expect(nextAgent.ensureSessionReady).toHaveBeenCalledTimes(1)
    expect(managed).toMatchObject({ llmConnection: 'b', model: 'same-model', agentProvider: 'pi', thinkingLevel: 'high', enabledSourceSlugs: ['approved-source'], permissionMode: 'safe', workingDirectory: root })
    expect(managed.tokenUsage).toMatchObject({ inputTokens: 123, costUsd: 0.2, contextWindow: 64000 })
    expect(managed.messages[0]?.content).toBe('请记住前文')
    expect(events.filter(event => event.type === 'session_model_changed')).toEqual([expect.objectContaining({ type: 'session_model_changed', connectionSlug: 'b', model: 'same-model', supportsBranching: true, thinkingLevel: 'high', contextWindow: 64000 })])
    expect(events.filter(event => event.type === 'session_model_switching').map(event => event.isSwitching)).toEqual([true, false])
    await manager.updateSessionModel(managed.id, 'ws', 'model-a', 'a')
    expect(managed.llmConnection).toBe('a')
    expect(loadSession(root, managed.id)?.model).toBe('model-a')
  })

  test('重启从持久化字段恢复渠道、模型、SDK 身份和执行引擎', async () => {
    await manager.updateSessionModel(managed.id, 'ws', 'model-b', 'b')
    const restored = createManagedSession(loadSession(root, managed.id)!, managed.workspace, { messagesLoaded: true })
    expect(restored).toMatchObject({ llmConnection: 'b', model: 'model-b', agentProvider: 'pi', sdkSessionId: 'sdk-restored' })
    expect(restored.messages).toEqual(managed.messages)
  })

  test('预热失败恢复原选择和 SDK 身份，失败实例释放且不广播成功', async () => {
    nextAgent.ensureSessionReady.mockRejectedValueOnce(new Error('模拟恢复失败'))
    await expect(manager.updateSessionModel(managed.id, 'ws', 'model-b', 'b')).rejects.toThrow('模拟恢复失败')
    expect(managed).toMatchObject({ llmConnection: 'a', model: 'same-model', sdkSessionId: 'sdk-original', thinkingLevel: 'max' })
    expect(managed.agent).toBeNull()
    expect(nextAgent.dispose).toHaveBeenCalledTimes(1)
    expect(loadSession(root, managed.id)).toMatchObject({ llmConnection: 'a', model: 'same-model', sdkSessionId: 'sdk-original' })
    expect(events.filter(event => event.type === 'session_model_changed')).toEqual([])
  })

  test('持久化失败恢复原磁盘选择，不能把无报错的存储队列当成成功', async () => {
    const flush = sessionPersistenceQueue.flush.bind(sessionPersistenceQueue)
    let calls = 0
    jest.spyOn(sessionPersistenceQueue, 'flush').mockImplementation(async id => {
      calls += 1
      if (calls === 2) {
        // 模拟队列内部吞掉磁盘错误且没有写入目标选择。
        sessionPersistenceQueue.cancel(id)
        return
      }
      await flush(id)
    })
    await expect(manager.updateSessionModel(managed.id, 'ws', 'model-b', 'b')).rejects.toThrow('未能保存')
    expect(managed.llmConnection).toBe('a')
    expect(loadSession(root, managed.id)).toMatchObject({ llmConnection: 'a', model: 'same-model', sdkSessionId: 'sdk-original' })
    expect(events.filter(event => event.type === 'session_model_changed')).toEqual([])
  })

  test('发送准备阶段已经占用会话，不能在开始生成前插入切换', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    ;(manager as any).sendMessageWithSelection = () => pending
    const sending = manager.sendMessage(managed.id, '继续')
    await expect(manager.updateSessionModel(managed.id, 'ws', 'same-model', 'b')).rejects.toThrow('正在处理')
    release()
    await sending
    expect(managed.activeRuntimeOperations).toBe(0)
    expect(oldAgent.dispose).not.toHaveBeenCalled()
  })

  test('两个窗口同时发送只启动一轮，另一条沿用原消息队列', async () => {
    let release!: () => void
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const pending = new Promise<void>(resolve => { release = resolve })
    const runs: string[] = []
    managed.enabledSourceSlugs = []
    ;(manager as any).runTurn = async (_session: unknown, message: string) => {
      runs.push(message)
      started()
      await pending
      managed.isProcessing = false
    }
    const first = manager.sendMessage(managed.id, '第一条', undefined, undefined, { hidden: true })
    const second = manager.sendMessage(managed.id, '第二条', undefined, undefined, { hidden: true })
    await ready
    await second
    expect(runs).toEqual(['第一条'])
    expect(managed.messageQueue.map(item => item.message)).toEqual(['第二条'])
    release()
    await first
  })

  test('切换期间发送等待成功，拒绝第二次切换且预热回调不提前写盘', async () => {
    let release!: () => void
    let signalReady!: () => void
    const ready = new Promise<void>(resolve => { signalReady = resolve })
    const pending = new Promise<void>(resolve => { release = resolve })
    nextAgent.ensureSessionReady.mockImplementationOnce(async () => {
      signalReady()
      await pending
      return { thinkingLevel: 'high', contextWindow: 64000 }
    })
    const switching = manager.updateSessionModel(managed.id, 'ws', 'model-b', 'b')
    await ready
    expect(await manager.getSession(managed.id)).toMatchObject({ llmConnection: 'a', model: 'same-model', isModelSwitching: true })
    expect(loadSession(root, managed.id)).toMatchObject({ llmConnection: 'a', model: 'same-model', sdkSessionId: 'sdk-original' })
    const sent: string[] = []
    ;(manager as any).sendMessageWithSelection = async () => { sent.push(managed.llmConnection!) }
    const sending = manager.sendMessage(managed.id, '继续')
    await expect(manager.updateSessionModel(managed.id, 'ws', 'model-a', 'a')).rejects.toThrow('正在处理')
    expect(sent).toEqual([])
    expect(managed.messages).toHaveLength(1)
    release()
    await Promise.all([switching, sending])
    expect(sent).toEqual(['b'])
    expect(events.filter(event => event.type === 'session_model_changed')).toHaveLength(1)
    expect((await manager.getSession(managed.id))?.isModelSwitching).toBe(false)
  })

  test('切换失败后等待中的发送继续使用已回滚的原渠道，不丢消息', async () => {
    let rejectReady!: (error: Error) => void
    let signalReady!: () => void
    const ready = new Promise<void>(resolve => { signalReady = resolve })
    nextAgent.ensureSessionReady.mockImplementationOnce(async () => {
      signalReady()
      return await new Promise<never>((_resolve, reject) => { rejectReady = reject })
    })
    const switching = manager.updateSessionModel(managed.id, 'ws', 'model-b', 'b').catch(error => error)
    await ready
    const sent: string[] = []
    ;(manager as any).sendMessageWithSelection = async () => { sent.push(managed.llmConnection!) }
    const sending = manager.sendMessage(managed.id, '继续')
    expect(sent).toEqual([])
    rejectReady(new Error('模拟目标失败'))
    const error = await switching
    await sending
    expect(error.message).toBe('模拟目标失败')
    expect(sent).toEqual(['a'])
    expect(loadSession(root, managed.id)?.llmConnection).toBe('a')
    expect(managed.selectionSwitchPromise).toBeUndefined()
    expect((await manager.getSession(managed.id))?.isModelSwitching).toBe(false)
  })

  test('渠道、模型和认证错误不会回退默认渠道，也不释放原实例', async () => {
    await expect(manager.updateSessionModel(managed.id, 'ws', 'same-model', 'deleted')).rejects.toThrow('不存在')
    await expect(manager.updateSessionModel(managed.id, 'ws', 'model-a', 'b')).rejects.toThrow('不属于')
    jest.spyOn(getCredentialManager(), 'hasLlmCredentials').mockResolvedValueOnce(false)
    await expect(manager.updateSessionModel(managed.id, 'ws', 'same-model', 'b')).rejects.toThrow('认证')
    expect(managed.llmConnection).toBe('a')
    expect(oldAgent.dispose).not.toHaveBeenCalled()
    expect(events.filter(event => event.type === 'session_model_changed')).toEqual([])
  })

  test('现有 Claude CLI 历史禁止跨引擎及跨 Claude CLI 渠道', async () => {
    managed.agentProvider = 'anthropic'
    managed.llmConnection = 'cli'
    await expect(manager.updateSessionModel(managed.id, 'ws', 'same-model', 'b')).rejects.toThrow('Claude CLI')
    await expect(manager.updateSessionModel(managed.id, 'ws', 'same-model', 'cli-other')).rejects.toThrow('Claude CLI')
    await manager.updateSessionModel(managed.id, 'ws', 'model-cli', 'cli')
    expect(managed.model).toBe('model-cli')
    expect(nextAgent.ensureSessionReady).not.toHaveBeenCalled()
  })

  test('空会话仍可在发送前改选执行引擎', async () => {
    managed.messages = []
    await manager.updateSessionModel(managed.id, 'ws', 'same-model', 'cli')
    expect(managed).toMatchObject({ llmConnection: 'cli', agentProvider: 'anthropic' })
    expect(managed.sdkSessionId).toBeUndefined()
  })

  test('原渠道删除时使用持久化引擎恢复，旧会话须有 SDK 文件证据', async () => {
    writeConnections(connections.filter(item => item.slug !== 'a'))
    managed.agent = null
    managed.agentProvider = undefined
    await expect(manager.updateSessionModel(managed.id, 'ws', 'same-model', 'b')).rejects.toThrow('无法确定')
    const directory = join(root, 'sessions', managed.id, '.pi-sessions')
    mkdirSync(directory)
    writeFileSync(join(directory, 'history.jsonl'), JSON.stringify({ type: 'session', version: 3, id: 'sdk-original' }) + '\n')
    await manager.updateSessionModel(managed.id, 'ws', 'same-model', 'b')
    expect((await manager.getSession(managed.id))?.agentProvider).toBe('pi')
    expect(managed.messages[0]?.content).toBe('请记住前文')
  })

  test('忙碌、审批、队列和后台工作均拒绝切换', async () => {
    managed.isProcessing = true
    await expect(manager.updateSessionModel(managed.id, 'ws', 'same-model', 'b')).rejects.toThrow('正在处理')
    managed.isProcessing = false
    managed.activeRuntimeOperations = 1
    await expect(manager.updateSessionModel(managed.id, 'ws', 'same-model', 'b')).rejects.toThrow('正在处理')
    managed.activeRuntimeOperations = 0
    managed.pendingAuthRequest = { requestId: 'auth' } as never
    await expect(manager.updateSessionModel(managed.id, 'ws', 'same-model', 'b')).rejects.toThrow('正在处理')
    managed.pendingAuthRequest = undefined
    managed.backgroundTaskRegistry.set('task', { taskId: 'task', status: 'running', startTime: 1 })
    await expect(manager.updateSessionModel(managed.id, 'ws', 'same-model', 'b')).rejects.toThrow('正在处理')
    expect(oldAgent.dispose).not.toHaveBeenCalled()
  })

  test('相同选择不重建；旧切换渠道入口使用相同原子逻辑', async () => {
    await manager.updateSessionModel(managed.id, 'ws', 'same-model', 'a')
    expect(oldAgent.dispose).not.toHaveBeenCalled()
    expect(events.filter(event => event.type === 'session_model_changed')).toEqual([])
    await manager.setSessionConnection(managed.id, 'b')
    expect(managed).toMatchObject({ llmConnection: 'b', model: 'same-model' })
    expect(events.filter(event => event.type === 'session_model_changed')[0]?.connectionSlug).toBe('b')
  })

  test('后台 shell 自然完成后释放阻塞，可以继续切换模型', async () => {
    managed.isProcessing = true
    await (manager as any).processEvent(managed, { type: 'shell_backgrounded', shellId: 'shell-task-1', toolUseId: 'shell-tool', command: '测试后台命令' })
    managed.isProcessing = false
    await expect(manager.updateSessionModel(managed.id, 'ws', 'same-model', 'b')).rejects.toThrow('正在处理')
    managed.isProcessing = true
    await (manager as any).processEvent(managed, { type: 'task_completed', taskId: 'shell-task-1', status: 'completed' })
    managed.isProcessing = false
    expect(managed.backgroundShellCommands.size).toBe(0)
    await manager.updateSessionModel(managed.id, 'ws', 'same-model', 'b')
    expect(managed.llmConnection).toBe('b')
  })
})

test('真实定时任务在聊天改选、默认值变更及管理器重启后仍请求保存的 A/M1', async () => {
  const root = mkdtempSync(join(tmpdir(), 'opc-automation-binding-'))
  const workspaceRoot = join(root, 'workspace')
  const runtimeDirectory = join(root, 'packages', 'pi-agent-server', 'dist')
  const runtimeEntry = join(runtimeDirectory, 'index.js')
  const workspaceConfigPath = join(workspaceRoot, 'config.json')
  const automationPath = join(workspaceRoot, 'automations.json')
  const defaultsPath = join(isolatedConfigDir, 'config-defaults.json')
  const previousBun = process.env.OPCAGENT_BUN
  process.env.OPCAGENT_BUN = process.execPath
  mkdirSync(workspaceRoot)
  mkdirSync(runtimeDirectory, { recursive: true })
  // 仅提供真实运行时入口定位，直接加载当前源码，避免测试误用过期 dist。
  writeFileSync(runtimeEntry, `import ${JSON.stringify(pathToFileURL(resolve(import.meta.dir, '../../..', 'pi-agent-server/src/index.ts')).href)};\n`)
  copyFileSync(resolve(import.meta.dir, '../../../..', 'apps/electron/resources/config-defaults.json'), defaultsPath)
  const requests: Array<{ channel: string; body: Record<string, unknown> }> = []
  const errors: unknown[] = []
  const ids = new Set<string>()
  function endpoint(channel: 'a' | 'b') {
    return Bun.serve({
      hostname: '127.0.0.1', port: 0,
      async fetch(request) {
        if (!new URL(request.url).pathname.endsWith('/chat/completions')) return new Response('未找到', { status: 404 })
        requests.push({ channel, body: await request.json() as Record<string, unknown> })
        const chunks = [
          { id: 'automation-binding-proof', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: `渠道${channel}保留的任务结果。` } }] },
          { id: 'automation-binding-proof', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        ]
        return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
      },
    })
  }
  const endpointA = endpoint('a')
  const endpointB = endpoint('b')
  const realConnections = connections.filter(connection => connection.slug === 'a' || connection.slug === 'b').map(connection => ({
    ...connection,
    baseUrl: `http://127.0.0.1:${connection.slug === 'a' ? endpointA.port : endpointB.port}/v1`,
    customEndpoint: { api: 'openai-completions' },
  }))
  const workspace = { id: 'automation-proof', slug: 'proof', name: '自动化固定绑定验证', rootPath: workspaceRoot, createdAt: 1 }
  function saveDefaults(channel: 'a' | 'b') {
    writeFileSync(configPath, JSON.stringify({ workspaces: [workspace], llmConnections: realConnections, defaultLlmConnection: channel, activeWorkspaceId: workspace.id, activeSessionId: null }))
    writeFileSync(workspaceConfigPath, JSON.stringify({ id: workspace.id, slug: workspace.slug, name: workspace.name, createdAt: 1, updatedAt: 1, defaults: { defaultLlmConnection: channel, model: `model-${channel}`, permissionMode: 'safe' } }))
  }
  const taskContents = JSON.stringify({ automations: { SchedulerTick: [{ id: 'fixed-model-task', name: '固定渠道任务', cron: '* * * * *', timezone: 'Asia/Shanghai', actions: [{ type: 'prompt', prompt: '执行固定任务并记住松风口令', llmConnection: 'a', model: 'model-a' }] }] } })
  writeFileSync(automationPath, taskContents)
  saveDefaults('a')
  setSessionPlatform({
    appRootPath: root, resourcesPath: root, isPackaged: false, appVersion: 'test', isDebugMode: false,
    logger: { info() {}, debug() {}, warn() {}, error(...args) { errors.push(args) } },
    imageProcessor: { async getMetadata() { return null }, async process(input) { return Buffer.isBuffer(input) ? input : Buffer.from(input) } },
  })
  const { AutomationSystem } = await import('@opcagent/shared/automations')
  let manager = new SessionManager()
  let scheduled: Promise<void> | undefined
  function createSystem() {
    return new AutomationSystem({
      workspaceId: workspace.id, workspaceRootPath: workspaceRoot, enableScheduler: false,
      onPromptsReady(prompts) {
        scheduled = (manager as unknown as { executeAutomationPrompts(workspaceId: string, path: string, prompts: unknown[]): Promise<void> })
          .executeAutomationPrompts(workspace.id, workspaceRoot, prompts)
      },
    })
  }
  let system = createSystem()
  function captureEvents() {
    manager.setEventSink((_channel, _target, event) => {
      if (event?.type === 'error' || event?.type === 'typed_error') errors.push(event)
    })
  }
  async function tick(): Promise<string> {
    const before = new Set(manager.getSessions().map(session => session.id))
    scheduled = undefined
    await system.eventBus.emit('SchedulerTick', { workspaceId: workspace.id, timestamp: Date.now(), localTime: new Date().toISOString(), utcTime: new Date().toISOString() })
    expect(scheduled).toBeDefined()
    await scheduled
    const created = manager.getSessions().filter(session => !before.has(session.id))
    expect(created).toHaveLength(1)
    const id = created[0]!.id
    ids.add(id)
    expect(loadSession(workspaceRoot, id)).toMatchObject({ llmConnection: 'a', model: 'model-a' })
    expect(requests.at(-1)).toMatchObject({ channel: 'a', body: { model: 'model-a' } })
    return id
  }
  async function stopManager() {
    await manager.flushAllSessions()
    for (const session of (manager as any).sessions.values()) await session.agent?.disposeForRestart?.()
    manager.cleanup()
  }
  try {
    await manager.initialize()
    captureEvents()
    const chat = await manager.createSession(workspace.id, { name: '普通聊天', llmConnection: 'a', model: 'model-a' })
    ids.add(chat.id)
    await manager.updateSessionModel(chat.id, workspace.id, 'model-b', 'b')
    await manager.sendMessage(chat.id, '普通聊天已经改用渠道B')
    expect(requests.at(-1)).toMatchObject({ channel: 'b', body: { model: 'model-b' } })
    const firstRunId = await tick()
    await manager.updateSessionModel(firstRunId, workspace.id, 'model-b', 'b')
    await manager.sendMessage(firstRunId, '在结果会话继续任务，保留前文口令')
    expect(requests.at(-1)).toMatchObject({ channel: 'b', body: { model: 'model-b' } })
    expect(JSON.stringify(requests.at(-1)?.body.messages)).toContain('渠道a保留的任务结果')
    expect(readFileSync(automationPath, 'utf8')).toBe(taskContents)

    saveDefaults('b')
    await system.dispose()
    await stopManager()
    manager = new SessionManager()
    await manager.initialize()
    captureEvents()
    system = createSystem()
    expect(await manager.getSession(firstRunId)).toMatchObject({ llmConnection: 'b', model: 'model-b' })
    const newChat = await manager.createSession(workspace.id, { name: '默认值对照' })
    ids.add(newChat.id)
    expect(newChat).toMatchObject({ llmConnection: 'b', model: 'model-b' })
    const nextRunId = await tick()
    expect(nextRunId).not.toBe(firstRunId)
    expect(readFileSync(automationPath, 'utf8')).toBe(taskContents)
    expect(errors).toEqual([])

    const action = system.getMatchersForEvent('SchedulerTick')[0]!.actions[0]!
    if (action.type !== 'prompt') throw new Error('验证任务动作类型发生变化')
    const manualRun = await manager.executePromptAutomation({ workspaceId: workspace.id, workspaceRootPath: workspaceRoot, prompt: action.prompt, llmConnection: action.llmConnection, model: action.model, automationName: '固定任务手动测试', waitForCompletion: true })
    ids.add(manualRun.sessionId)
    expect(loadSession(workspaceRoot, manualRun.sessionId)).toMatchObject({ llmConnection: 'a', model: 'model-a' })
    expect(requests.at(-1)).toMatchObject({ channel: 'a', body: { model: 'model-a' } })
    expect(readFileSync(automationPath, 'utf8')).toBe(taskContents)
    expect(errors).toEqual([])
  } finally {
    await system.dispose()
    for (const session of manager.getSessions()) ids.add(session.id)
    await stopManager()
    endpointA.stop(true)
    endpointB.stop(true)
    if (previousBun === undefined) delete process.env.OPCAGENT_BUN
    else process.env.OPCAGENT_BUN = previousBun
    const removeFile = (path: string) => { if (existsSync(path)) unlinkSync(path) }
    const removeEmpty = (path: string) => { if (existsSync(path) && readdirSync(path).length === 0) rmdirSync(path) }
    for (const id of ids) {
      sessionPersistenceQueue.cancel(id)
      const sessionPath = join(workspaceRoot, 'sessions', id)
      const sdkDirectory = join(sessionPath, '.pi-sessions')
      const sdkFiles = existsSync(sdkDirectory) ? readdirSync(sdkDirectory).filter(file => file.endsWith('.jsonl')) : []
      if (sdkFiles.length === 1) removeFile(join(sdkDirectory, sdkFiles[0]!))
      removeFile(join(sessionPath, 'session.jsonl'))
      removeFile(join(sessionPath, 'meta', 'pi-turn-anchors.json'))
      removeFile(join(sessionPath, '.pi-agent', 'settings.json'))
      for (const directory of ['.pi-sessions', '.pi-agent', 'meta', 'attachments', 'plans', 'long_responses', 'data', 'downloads']) removeEmpty(join(sessionPath, directory))
      removeEmpty(sessionPath)
    }
    removeFile(automationPath)
    removeFile(workspaceConfigPath)
    removeFile(join(workspaceRoot, 'events.jsonl'))
    removeFile(join(workspaceRoot, 'automations-history.jsonl'))
    removeFile(runtimeEntry)
    removeFile(defaultsPath)
    removeEmpty(join(workspaceRoot, 'sessions'))
    removeEmpty(join(workspaceRoot, 'sources'))
    removeEmpty(workspaceRoot)
    removeEmpty(runtimeDirectory)
    removeEmpty(join(root, 'packages', 'pi-agent-server'))
    removeEmpty(join(root, 'packages'))
    removeEmpty(root)
    removeEmpty(join(isolatedConfigDir, 'themes'))
    removeEmpty(join(isolatedConfigDir, 'permissions'))
  }
}, 90_000)

afterAll(() => {
  if (existsSync(configPath)) unlinkSync(configPath)
  const logDirectory = join(isolatedConfigDir, 'logs')
  if (existsSync(logDirectory)) rmdirSync(logDirectory)
  rmdirSync(isolatedConfigDir)
  if (previousConfigDir === undefined) delete process.env.CONFIG_DIR
  else process.env.CONFIG_DIR = previousConfigDir
})

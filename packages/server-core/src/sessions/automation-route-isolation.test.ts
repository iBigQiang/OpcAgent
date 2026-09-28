import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { SessionManager } from './SessionManager'

describe('定时任务的渠道模型与聊天选择隔离', () => {
  test('调度透传任务的固定选择，不复用触发会话的渠道或会话 ID', async () => {
    const requests: Array<Record<string, unknown>> = []
    const prompt = Object.freeze({
      prompt: '继续执行每日任务',
      sessionId: 'chat-now-on-channel-b',
      llmConnection: 'channel-a',
      model: 'model-a',
      automationName: '每日任务',
    })
    const manager = new SessionManager()
    manager.executePromptAutomation = async (input) => {
      requests.push(input as unknown as Record<string, unknown>)
      return { sessionId: `automation-run-${requests.length}` }
    }
    const dispatch = manager as unknown as {
      executeAutomationPrompts(workspaceId: string, root: string, prompts: unknown[]): Promise<void>
    }

    await dispatch.executeAutomationPrompts('workspace-test', 'unused-test-root', [prompt])
    await dispatch.executeAutomationPrompts('workspace-test', 'unused-test-root', [prompt])

    expect(requests).toHaveLength(2)
    for (const request of requests) {
      expect(request.llmConnection).toBe('channel-a')
      expect(request.model).toBe('model-a')
      expect(request).not.toHaveProperty('sessionId')
    }
    expect(prompt.llmConnection).toBe('channel-a')
    expect(prompt.model).toBe('model-a')
  })

  test('每次执行都以任务绑定创建新会话，不继承上次结果会话的改选', async () => {
    const created: Array<{ id: string; llmConnection?: string; model?: string }> = []
    const sent: string[] = []
    const manager = new SessionManager()
    manager.createSession = async (_workspaceId, options) => {
      const session = {
        id: `automation-result-${created.length + 1}`,
        llmConnection: options?.llmConnection,
        model: options?.model,
      }
      created.push(session)
      return session as Awaited<ReturnType<SessionManager['createSession']>>
    }
    manager.sendMessage = async (sessionId) => { sent.push(sessionId) }
    const input = Object.freeze({
      workspaceId: 'workspace-test',
      // 不存在的测试工作区不含 Sources，也不会创建配置或历史文件。
      workspaceRootPath: resolve(import.meta.dir, '__missing_automation_route_fixture__'),
      prompt: '执行固定任务',
      llmConnection: 'channel-a',
      model: 'model-a',
    })

    await manager.executePromptAutomation(input)
    created[0]!.llmConnection = 'channel-b'
    created[0]!.model = 'model-b'
    await manager.executePromptAutomation(input)

    expect(created[1]).toEqual({
      id: 'automation-result-2', llmConnection: 'channel-a', model: 'model-a',
    })
    expect(sent).toEqual(['automation-result-1', 'automation-result-2'])
    expect(input.llmConnection).toBe('channel-a')
    expect(input.model).toBe('model-a')
  })
})

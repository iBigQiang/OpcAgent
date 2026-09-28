import { describe, expect, it } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'
import type { BackendConfig } from '../backend/types.ts'

function createConfig(sessionOverrides?: Record<string, unknown>): BackendConfig {
  return {
    provider: 'pi',
    workspace: {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: '/tmp/opcagent-test',
    } as any,
    session: {
      id: 'session-test',
      workspaceRootPath: '/tmp/opcagent-test',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      ...sessionOverrides,
    } as any,
    isHeadless: true,
  }
}

describe('PiAgent branching capability', () => {
  it('reports supportsBranching=true', () => {
    const agent = new PiAgent(createConfig())
    expect(agent.supportsBranching).toBe(true)
    agent.destroy()
  })

  it('throws preflight error for branched session missing branchFromSessionPath', async () => {
    const agent = new PiAgent(createConfig({ branchFromMessageId: 'msg-parent' }))

    await expect(agent.ensureBranchReady()).rejects.toThrow(
      'Pi branch preflight failed: missing branchFromSessionPath metadata'
    )

    agent.destroy()
  })

  it('passes preflight when subprocess reports a valid Pi session id', async () => {
    const agent = new PiAgent(
      createConfig({
        branchFromMessageId: 'msg-parent',
        branchFromSessionPath: '/tmp/opcagent-test/sessions/parent',
      })
    )

    ;(agent as any).requestEnsureSessionReady = async () => 'pi-session-123'

    await expect(agent.ensureBranchReady()).resolves.toBeUndefined()
    expect(agent.getSessionId()).toBe('pi-session-123')

    agent.destroy()
  })

  it('普通会话预热同步实际模型能力和 SDK 身份', async () => {
    const agent = new PiAgent(createConfig())
    ;(agent as any).ensureSubprocess = async () => {}
    ;(agent as any).send = (message: { id: string }) => {
      ;(agent as any).handleEnsureSessionReadyResult({ id: message.id, sessionId: 'pi-restored', thinkingLevel: 'high', contextWindow: 64000 })
    }
    await expect(agent.ensureSessionReady()).resolves.toEqual({ thinkingLevel: 'high', contextWindow: 64000 })
    expect(agent.getSessionId()).toBe('pi-restored')
    expect(agent.getThinkingLevel()).toBe('high')
    agent.destroy()
  })

  it('预热错误直接拒绝请求，不等待超时也不更新 SDK 身份', async () => {
    const agent = new PiAgent(createConfig({ sdkSessionId: 'pi-original' }))
    ;(agent as any).ensureSubprocess = async () => {}
    ;(agent as any).send = (message: { id: string }) => {
      ;(agent as any).handleEnsureSessionReadyResult({ id: message.id, sessionId: null, errorMessage: '历史不可恢复' })
    }
    await expect(agent.ensureSessionReady()).rejects.toThrow('历史不可恢复')
    expect(agent.getSessionId()).toBe('pi-original')
    agent.destroy()
  })
})

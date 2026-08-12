import { describe, expect, it } from 'bun:test'
import type { Message } from '../../../shared/types'
import {
  buildSafeContinuationDraft,
  buildSafeContinuationSessionOptions,
  isAgentRouterContextRejection,
} from '../safe-session-continuation'

function message(overrides: Partial<Message> & Pick<Message, 'role' | 'content'>): Message {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('safe session continuation', () => {
  it('copies only visible final user and assistant text', () => {
    const draft = buildSafeContinuationDraft([
      message({ role: 'user', content: 'Question' }),
      message({ role: 'assistant', content: 'Intermediate', isIntermediate: true }),
      message({ role: 'tool', content: 'Tool output', toolName: 'read' }),
      message({ role: 'assistant', content: 'Answer' }),
      message({ role: 'error', content: '401 UNAUTHENTICATED', isError: true }),
      message({ role: 'user', content: 'Hidden nudge', hidden: true }),
    ])

    expect(draft).toContain('[User]\nQuestion')
    expect(draft).toContain('[Assistant]\nAnswer')
    expect(draft).not.toContain('Intermediate')
    expect(draft).not.toContain('Tool output')
    expect(draft).not.toContain('401 UNAUTHENTICATED')
    expect(draft).not.toContain('Hidden nudge')
  })

  it('keeps the newest visible messages within the draft limit', () => {
    const draft = buildSafeContinuationDraft([
      message({ role: 'user', content: 'old context' }),
      message({ role: 'assistant', content: 'x'.repeat(1_100) }),
      message({ role: 'user', content: 'latest request' }),
    ], 500)

    expect(draft).toContain('latest request')
    expect(draft).not.toContain('old context')
    expect(draft).toContain('Earlier visible messages were omitted')
    expect(draft.length).toBeLessThanOrEqual(500)
  })

  it('recognizes AgentRouter-style 401 context rejection errors', () => {
    expect(isAgentRouterContextRejection(message({
      role: 'error',
      content: 'Invalid API Key',
      errorCode: 'invalid_api_key',
      errorOriginal: '401 UNAUTHENTICATED',
    }))).toBe(true)
    expect(isAgentRouterContextRejection(message({
      role: 'error',
      content: 'Network unavailable',
      errorCode: 'network_error',
    }))).toBe(false)
    expect(isAgentRouterContextRejection(message({
      role: 'error',
      content: 'A source returned 401',
      errorCode: 'mcp_auth_required',
      errorOriginal: '401 Unauthorized',
    }))).toBe(false)
  })

  it('creates fresh-session options without SDK branch metadata', () => {
    const options = buildSafeContinuationSessionOptions({
      id: 'old-session',
      workspaceId: 'workspace-default',
      name: 'Old chat',
      createdAt: 1,
      lastUsedAt: 2,
      messages: [],
      llmConnection: 'agentrouter-connection',
      model: 'claude-opus-test',
      permissionMode: 'ask',
      thinkingLevel: 'medium',
      workingDirectory: 'D:\\project',
      enabledSourceSlugs: ['source-a'],
    } as any)

    expect(options).toMatchObject({
      name: 'Old chat (continued)',
      llmConnection: 'agentrouter-connection',
      model: 'claude-opus-test',
      thinkingLevel: 'off',
    })
    expect(options).not.toHaveProperty('branchFromMessageId')
    expect(options).not.toHaveProperty('branchFromSessionId')
    expect(options).not.toHaveProperty('parentSessionId')
  })
})

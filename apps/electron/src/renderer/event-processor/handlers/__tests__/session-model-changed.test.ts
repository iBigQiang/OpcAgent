import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { handleSessionModelChanged } from '../session'
import { processEvent } from '../../processor'
import { initializeSessionsAtom, replaceLoadedSessionAtom, sessionAtomFamily, sessionMetaMapAtom, updateSessionAtom } from '../../../atoms/sessions'
import type { SessionState, SessionModelChangedEvent } from '../../types'

function state(): SessionState {
  return {
    session: {
      id: 'session', workspaceId: 'workspace', workspaceName: 'workspace',
      lastMessageAt: 1, isProcessing: false,
      messages: [{ id: 'message', role: 'user', content: '继续之前的工具任务', timestamp: 1 }],
      model: 'same-model', llmConnection: 'a', agentProvider: 'pi', supportsBranching: true,
      thinkingLevel: 'high', permissionMode: 'ask', enabledSourceSlugs: ['source'],
      tokenUsage: { inputTokens: 150, outputTokens: 40, totalTokens: 190, contextTokens: 100, costUsd: 0.2, contextWindow: 200000, cacheReadTokens: 10 },
    },
    streaming: null,
  }
}

const baseEvent: SessionModelChangedEvent = {
  type: 'session_model_changed', sessionId: 'session', model: 'same-model',
}

describe('渠道与模型权威事件', () => {
  test('同名模型跨渠道仍原子同步，并保留上下文、工具权限与累计用量', () => {
    const before = state()
    const { state: after, effects } = handleSessionModelChanged(before, {
      ...baseEvent, connectionSlug: 'b', agentProvider: 'pi', supportsBranching: false,
      thinkingLevel: 'off', contextWindow: 32000,
    })
    expect(after.session.llmConnection).toBe('b')
    expect(after.session.model).toBe('same-model')
    expect(after.session.supportsBranching).toBe(false)
    expect(after.session.thinkingLevel).toBe('off')
    expect(after.session.messages).toBe(before.session.messages)
    expect(after.session.enabledSourceSlugs).toBe(before.session.enabledSourceSlugs)
    expect(after.session.permissionMode).toBe('ask')
    expect(after.session.tokenUsage).toEqual({ ...before.session.tokenUsage!, contextWindow: 32000 })
    expect(before.session.llmConnection).toBe('a')
    expect(effects).toEqual([])
  })

  test('兼容旧事件：未携带的新字段不覆盖已有值', () => {
    const before = state()
    const { state: after } = handleSessionModelChanged(before, { ...baseEvent, model: 'next-model' })
    expect(after.session).toEqual({ ...before.session, model: 'next-model' })
    expect(after.session.tokenUsage).toBe(before.session.tokenUsage)
  })

  test('目标模型容量未知时清理旧窗口值，保留历史用量', () => {
    const before = state()
    const { state: after } = handleSessionModelChanged(before, { ...baseEvent, contextWindow: null })
    expect(after.session.tokenUsage?.contextWindow).toBeUndefined()
    expect(after.session.tokenUsage?.inputTokens).toBe(150)
    expect(after.session.tokenUsage?.costUsd).toBe(0.2)
  })

  test('空会话选择另一引擎后同步引擎身份和上下文容量', () => {
    const before = state()
    before.session.messages = []
    before.session.tokenUsage = undefined
    const { state: after } = handleSessionModelChanged(before, {
      ...baseEvent, connectionSlug: 'cli', agentProvider: 'anthropic', contextWindow: 200000,
    })
    expect(after.session.agentProvider).toBe('anthropic')
    expect(after.session.llmConnection).toBe('cli')
    expect(after.session.tokenUsage?.contextWindow).toBe(200000)
  })
})

describe('跨窗口模型切换状态', () => {
  test('模型更新事件到达后仍等待结束事件，避免提前重新启用发送', () => {
    const switching = processEvent(state(), { type: 'session_model_switching', sessionId: 'session', isSwitching: true }).state
    const changed = processEvent(switching, { ...baseEvent, connectionSlug: 'b' }).state
    expect(changed.session.isModelSwitching).toBe(true)
    expect(changed.session.llmConnection).toBe('b')
    const completed = processEvent(changed, { type: 'session_model_switching', sessionId: 'session', isSwitching: false }).state
    expect(completed.session.isModelSwitching).toBe(false)
    expect(completed.session.llmConnection).toBe('b')
  })

  test('起止事件保留会话内容、当前选择与流状态，不产生清理草稿的副作用', () => {
    const before = state()
    for (const isSwitching of [true, false]) {
      const result = processEvent(before, {
        type: 'session_model_switching', sessionId: before.session.id, isSwitching,
      })
      expect(result.state.session).toEqual({ ...before.session, isModelSwitching: isSwitching })
      expect(result.state.session.messages).toBe(before.session.messages)
      expect(result.state.streaming).toBe(before.streaming)
      expect(result.effects).toEqual([])
    }
  })

  test('两个窗口接收起止事件，仅更新目标会话及其元数据', () => {
    const windows = [createStore(), createStore()]
    const a = state().session
    const b = { ...a, id: 'other-session' }
    for (const store of windows) store.set(initializeSessionsAtom, [a, b])

    for (const isSwitching of [true, false]) {
      const event = { type: 'session_model_switching' as const, sessionId: a.id, isSwitching }
      for (const store of windows) {
        store.set(updateSessionAtom, event.sessionId, (session) => processEvent({ session: session!, streaming: null }, event).state.session)
        expect(store.get(sessionAtomFamily(a.id))?.isModelSwitching).toBe(isSwitching)
        expect(store.get(sessionMetaMapAtom).get(a.id)?.isModelSwitching).toBe(isSwitching)
        expect(store.get(sessionAtomFamily(b.id))?.isModelSwitching).toBeUndefined()
        expect(store.get(sessionMetaMapAtom).get(b.id)?.isModelSwitching).toBeUndefined()
      }
    }
  })

  test('重新加载服务端快照也能恢复切换状态，结束后解除限制', () => {
    const store = createStore()
    const session = state().session
    store.set(replaceLoadedSessionAtom, { ...session, isModelSwitching: true })
    expect(store.get(sessionAtomFamily(session.id))?.isModelSwitching).toBe(true)
    expect(store.get(sessionMetaMapAtom).get(session.id)?.isModelSwitching).toBe(true)

    store.set(replaceLoadedSessionAtom, { ...session, isModelSwitching: false })
    expect(store.get(sessionAtomFamily(session.id))?.isModelSwitching).toBe(false)
    expect(store.get(sessionMetaMapAtom).get(session.id)?.isModelSwitching).toBe(false)
    expect(store.get(sessionAtomFamily(session.id))?.messages).toEqual(session.messages)
  })
})

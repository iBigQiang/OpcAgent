import { describe, expect, test } from 'bun:test'
import { SessionManager, shouldDispatchAgentAutomation } from './SessionManager'

describe('automation origin recursion guard', () => {
  test('allows ordinary sessions and suppresses every automation-origin session', () => {
    expect(shouldDispatchAgentAutomation(undefined)).toBe(true)
    expect(shouldDispatchAgentAutomation({ automationName: 'daily', timestamp: 1 })).toBe(false)
    expect(shouldDispatchAgentAutomation({ automationName: 'tool watcher', event: 'PreToolUse', timestamp: 1 })).toBe(false)
  })
})

describe('automation topic binding', () => {
  test('installs the host bridge without importing the messaging package', async () => {
    const manager = new SessionManager()
    const bindings: Array<{ workspaceId: string; sessionId: string; topicName: string }> = []
    manager.setAutomationBinder(async input => { bindings.push(input) })

    const binder = (manager as any).automationBinder as ((input: { workspaceId: string; sessionId: string; topicName: string }) => Promise<void>) | undefined
    await binder?.({ workspaceId: 'workspace-1', sessionId: 'session-1', topicName: 'Daily brief' })

    expect(bindings).toEqual([{ workspaceId: 'workspace-1', sessionId: 'session-1', topicName: 'Daily brief' }])
  })
})

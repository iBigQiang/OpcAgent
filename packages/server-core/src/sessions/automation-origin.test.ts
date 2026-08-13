import { describe, expect, test } from 'bun:test'
import { shouldDispatchAgentAutomation } from './SessionManager'

describe('automation origin recursion guard', () => {
  test('allows ordinary sessions and suppresses every automation-origin session', () => {
    expect(shouldDispatchAgentAutomation(undefined)).toBe(true)
    expect(shouldDispatchAgentAutomation({ automationName: 'daily', timestamp: 1 })).toBe(false)
    expect(shouldDispatchAgentAutomation({ automationName: 'tool watcher', event: 'PreToolUse', timestamp: 1 })).toBe(false)
  })
})

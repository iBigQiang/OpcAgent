import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveAutomationPromptContext,
  SessionManager,
  shouldDispatchAgentAutomation,
} from './SessionManager'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    const historyPath = join(root, 'automations-history.jsonl')
    if (existsSync(historyPath)) unlinkSync(historyPath)
    if (existsSync(root)) rmdirSync(root)
  }
})

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

describe('automation prompt context', () => {
  test('deduplicates legacy and bracket skill/source mentions without rewriting unknown text or email addresses', () => {
    const context = resolveAutomationPromptContext(
      '@commit then @github with [skill:.agents:commit] [source:github] @unknown qa@example.com',
      ['commit', 'github', 'commit'],
      [{ config: { slug: 'github' } }] as never,
      [{ slug: 'commit' }] as never,
    )

    expect(context.skillSlugs).toEqual(['commit'])
    expect(context.sourceSlugs).toEqual(['github'])
    expect(context.prompt).toBe('[skill:commit] then @github with [skill:.agents:commit] [source:github] @unknown qa@example.com')
    expect(context.unknownMentions).toEqual(['unknown'])
  })

  test('honors the explicit bracket mention type when source and skill slugs overlap', () => {
    const context = resolveAutomationPromptContext(
      '[skill:shared] [source:shared] [skill:source-only] [source:skill-only]',
      undefined,
      [{ config: { slug: 'shared' } }, { config: { slug: 'source-only' } }] as never,
      [{ slug: 'shared' }, { slug: 'skill-only' }] as never,
    )

    expect(context.skillSlugs).toEqual(['shared'])
    expect(context.sourceSlugs).toEqual(['shared'])
    expect(context.unknownMentions).toEqual(['source-only', 'skill-only'])
  })
})

describe('automation prompt history', () => {
  test('records fulfilled and rejected prompt results without failing the batch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opcagent-automation-history-'))
    roots.push(root)
    const manager = new SessionManager()
    ;(manager as any).executePromptAutomation = async (input: { prompt: string }) => {
      if (input.prompt === 'fails') throw new Error('expected failure')
      return { sessionId: 'session-success' }
    }

    await (manager as any).executeAutomationPrompts('workspace-1', root, [
      { matcherId: 'success', prompt: 'works', mentions: [] },
      { matcherId: 'failure', prompt: 'fails', mentions: [] },
    ])

    const historyPath = join(root, 'automations-history.jsonl')
    const deadline = Date.now() + 1000
    while (!existsSync(historyPath) && Date.now() < deadline) await Bun.sleep(10)
    const history = readFileSync(historyPath, 'utf8').trim().split('\n').map(line => JSON.parse(line))

    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'success', ok: true, sessionId: 'session-success', prompt: 'works' }),
      expect.objectContaining({ id: 'failure', ok: false, error: 'Error: expected failure', prompt: 'fails' }),
    ]))
  })
})

import { expect, test } from 'bun:test'
import { MessagingRenderer } from '../renderer'
import { PlanTokenRegistry } from '../plan-tokens'
import type { ChannelBinding, PlatformAdapter, SentMessage } from '../types'

function binding(responseMode: ChannelBinding['config']['responseMode']): ChannelBinding {
  return {
    id: `binding-${responseMode}`,
    workspaceId: 'workspace-one',
    sessionId: 'session-one',
    platform: 'telegram',
    channelId: 'chat-one',
    enabled: true,
    createdAt: 1,
    config: { accessMode: 'inherit', responseMode, approvalChannel: 'chat', editIntervalMs: 3500 },
  }
}

function adapter() {
  const sent: string[] = []
  const edited: string[] = []
  const buttons: string[][] = []
  const value: PlatformAdapter = {
    platform: 'telegram',
    capabilities: { messageEditing: true, inlineButtons: true, maxButtons: 8, maxMessageLength: 4096, markdown: 'v2', webhookSupport: false },
    async initialize() {}, async destroy() {}, isConnected: () => true, onMessage() {},
    async sendText(channelId, text): Promise<SentMessage> { sent.push(text); return { platform: 'telegram', channelId, messageId: String(sent.length) } },
    async editMessage(_channelId, _messageId, text) { edited.push(text) },
    async sendButtons(channelId, text, rows): Promise<SentMessage> { sent.push(text); buttons.push(rows.map(row => row.id)); return { platform: 'telegram', channelId, messageId: String(sent.length) } },
  }
  return { value, sent, edited, buttons }
}

test('progress mode keeps state across events and edits the final response', async () => {
  const fake = adapter()
  const renderer = new MessagingRenderer()
  const target = binding('progress')
  await renderer.handle({ type: 'tool_start', sessionId: 'session-one', toolName: 'Read', toolUseId: 'tool', toolInput: {} }, target, fake.value)
  await renderer.handle({ type: 'text_complete', sessionId: 'session-one', text: 'final answer' }, target, fake.value)
  await renderer.handle({ type: 'complete', sessionId: 'session-one' }, target, fake.value)
  expect(fake.sent[0]).toContain('Using Read')
  expect(fake.edited.at(-1)).toBe('final answer')
})

test('final-only mode waits for complete', async () => {
  const fake = adapter()
  const renderer = new MessagingRenderer()
  const target = binding('final_only')
  await renderer.handle({ type: 'text_complete', sessionId: 'session-one', text: 'final answer' }, target, fake.value)
  expect(fake.sent).toEqual([])
  await renderer.handle({ type: 'complete', sessionId: 'session-one' }, target, fake.value)
  expect(fake.sent).toEqual(['final answer'])
})

test('permission and plan buttons are recorded only for their binding', async () => {
  const fake = adapter()
  const permissions: string[] = []
  const plans: string[] = []
  const renderer = new MessagingRenderer({
    planTokens: new PlanTokenRegistry(),
    recordPermissionMessage: (target, requestId) => permissions.push(`${target.id}:${requestId}`),
    recordPlanMessage: (target, token) => plans.push(`${target.id}:${token}`),
  })
  const target = binding('progress')
  await renderer.handle({ type: 'permission_request', sessionId: 'session-one', request: { sessionId: 'session-one', requestId: 'request-one', toolName: 'Write', description: 'write file', type: 'file_write' } }, target, fake.value)
  await renderer.handle({ type: 'plan_submitted', sessionId: 'session-one', message: { id: 'plan', role: 'plan', content: 'missing-plan-file', timestamp: 1 } }, target, fake.value)
  expect(permissions).toEqual(['binding-progress:request-one'])
  expect(plans).toHaveLength(1)
  expect(fake.buttons[0]).toEqual(['perm:allow:request-one', 'perm:deny:request-one'])
  expect(fake.buttons[1]?.every(value => value.startsWith('plan:'))).toBe(true)
})

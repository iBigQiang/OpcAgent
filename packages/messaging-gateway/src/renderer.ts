import type { SessionEvent } from '@opcagent/shared/protocol'
import type { PlanTokenRegistry } from './plan-tokens'
import type {
  ChannelBinding,
  InlineButton,
  PlatformAdapter,
  ResponseMode,
  SendOptions,
  SentMessage,
} from './types'

interface RenderState {
  streamingBuffer: string
  finalBuffer: string
  lastAssistantText: string
  streamingMessageId?: string
  progressMessageId?: string
  progressStatus?: string
  lastEditAt: number
}

interface PermissionRequestLike {
  requestId?: string
  toolName?: string
  description?: string
  command?: string
}

export type PlanMessageRecorder = (binding: ChannelBinding, token: string, messageId: string) => void
export type PermissionMessageRecorder = (binding: ChannelBinding, requestId: string, messageId: string) => void

const PLAN_INLINE_LIMIT = 3500
/** Stateful Craft-compatible renderer, isolated per workspace by the registry. */
export class MessagingRenderer {
  private readonly states = new Map<string, RenderState>()

  constructor(private readonly deps: {
    planTokens?: PlanTokenRegistry
    loadPlan?: (sessionId: string, planPath: string) => string | null
    recordPlanMessage?: PlanMessageRecorder
    recordPermissionMessage?: PermissionMessageRecorder
  } = {}) {}

  async handle(event: SessionEvent, binding: ChannelBinding, adapter: PlatformAdapter): Promise<void> {
    if (event.sessionId !== binding.sessionId) return
    if (event.type === 'permission_request') return this.permission(event.request, binding, adapter)
    if (event.type === 'credential_request') return this.credential(binding, adapter)
    if (event.type === 'plan_submitted') return this.plan(event.message.content, binding, adapter)
    if (event.type === 'error') return this.error(event.error, binding, adapter)
    if (event.type === 'typed_error') return this.error(event.error.message, binding, adapter)

    const mode = resolveMode(binding.config.responseMode, binding.config.streamResponses)
    if (mode === 'streaming') return this.streaming(event, binding, adapter)
    if (mode === 'progress') return this.progress(event, binding, adapter)
    return this.finalOnly(event, binding, adapter)
  }

  clearBinding(bindingId: string): void { this.states.delete(bindingId) }

  private state(bindingId: string): RenderState {
    let state = this.states.get(bindingId)
    if (!state) {
      state = { streamingBuffer: '', finalBuffer: '', lastAssistantText: '', lastEditAt: 0 }
      this.states.set(bindingId, state)
    }
    return state
  }

  private async streaming(event: SessionEvent, binding: ChannelBinding, adapter: PlatformAdapter): Promise<void> {
    const state = this.state(binding.id)
    if (event.type === 'text_delta') {
      state.streamingBuffer += event.delta
      if (supportsEditing(adapter)) await this.upsertStreaming(state, binding, adapter)
      return
    }
    if (event.type === 'text_complete') {
      const text = event.text.trim() || state.streamingBuffer.trim()
      if (text) {
        if (state.streamingMessageId && supportsEditing(adapter)) await adapter.editMessage!(binding.channelId, state.streamingMessageId, bounded(text, adapter), opts(binding.threadId))
        else await this.sendText(adapter, binding, text)
      }
      state.streamingBuffer = ''
      state.streamingMessageId = undefined
      return
    }
    if (event.type === 'tool_start') {
      if (binding.config.showToolActivity) await this.sendText(adapter, binding, `Using ${event.toolDisplayName || event.toolName}...`)
      else await adapter.sendTyping?.(binding.channelId, opts(binding.threadId)).catch(() => undefined)
      return
    }
    if (event.type === 'complete' || event.type === 'interrupted') this.reset(state)
  }

  private async upsertStreaming(state: RenderState, binding: ChannelBinding, adapter: PlatformAdapter): Promise<void> {
    const text = state.streamingBuffer.trim()
    if (!text) return
    const interval = Math.max(3500, binding.config.editIntervalMs ?? 3500)
    if (state.streamingMessageId && Date.now() - state.lastEditAt < interval) return
    if (!state.streamingMessageId) {
      const sent = await adapter.sendText(binding.channelId, bounded(text, adapter), opts(binding.threadId))
      state.streamingMessageId = messageId(sent)
    } else {
      await adapter.editMessage!(binding.channelId, state.streamingMessageId, bounded(text, adapter), opts(binding.threadId))
    }
    state.lastEditAt = Date.now()
  }

  private async progress(event: SessionEvent, binding: ChannelBinding, adapter: PlatformAdapter): Promise<void> {
    const state = this.state(binding.id)
    if (event.type === 'text_complete') {
      if (event.text.trim()) {
        if (!event.isIntermediate) state.finalBuffer = append(state.finalBuffer, event.text)
        state.lastAssistantText = event.text
      }
      await this.progressStatus(state, binding, adapter, 'Thinking...')
      return
    }
    if (event.type === 'tool_start') {
      await this.progressStatus(state, binding, adapter, `Using ${event.toolDisplayName || event.toolName}...`)
      return
    }
    if (event.type === 'tool_result') {
      await this.progressStatus(state, binding, adapter, 'Thinking...')
      return
    }
    if (event.type !== 'complete' && event.type !== 'interrupted') return
    const finalText = state.finalBuffer.trim() || state.lastAssistantText.trim()
    if (finalText) {
      if (state.progressMessageId && supportsEditing(adapter)) await adapter.editMessage!(binding.channelId, state.progressMessageId, bounded(finalText, adapter), opts(binding.threadId))
      else await this.sendText(adapter, binding, finalText)
    }
    this.reset(state)
  }

  private async progressStatus(state: RenderState, binding: ChannelBinding, adapter: PlatformAdapter, status: string): Promise<void> {
    if (!supportsEditing(adapter)) return
    if (!state.progressMessageId) {
      const sent = await adapter.sendText(binding.channelId, status, opts(binding.threadId))
      state.progressMessageId = messageId(sent)
      state.progressStatus = status
      return
    }
    if (state.progressStatus !== status) {
      await adapter.editMessage!(binding.channelId, state.progressMessageId, status, opts(binding.threadId))
      state.progressStatus = status
    }
  }

  private async finalOnly(event: SessionEvent, binding: ChannelBinding, adapter: PlatformAdapter): Promise<void> {
    const state = this.state(binding.id)
    if (event.type === 'text_complete' && event.text.trim()) {
      if (!event.isIntermediate) state.finalBuffer = append(state.finalBuffer, event.text)
      state.lastAssistantText = event.text
      return
    }
    if (event.type !== 'complete' && event.type !== 'interrupted') return
    const text = state.finalBuffer.trim() || state.lastAssistantText.trim()
    if (text) await this.sendText(adapter, binding, text)
    this.reset(state)
  }

  private async permission(request: PermissionRequestLike, binding: ChannelBinding, adapter: PlatformAdapter): Promise<void> {
    if (!request.requestId) return
    const description = request.description || request.command || request.toolName || 'Action approval required'
    if (binding.config.approvalChannel === 'chat' && supportsButtons(adapter)) {
      const buttons: InlineButton[] = [
        { id: `perm:allow:${request.requestId}`, label: 'Allow' },
        { id: `perm:deny:${request.requestId}`, label: 'Deny' },
      ]
      const sent = await adapter.sendButtons!(binding.channelId, `Permission required: ${description}`, buttons, opts(binding.threadId))
      const id = messageId(sent)
      if (id) this.deps.recordPermissionMessage?.(binding, request.requestId, id)
      return
    }
    await this.sendText(adapter, binding, `Permission required: ${description}\nApprove it in the desktop app to continue.`)
  }

  private async credential(binding: ChannelBinding, adapter: PlatformAdapter): Promise<void> {
    await this.sendText(adapter, binding, 'Credentials are required. Open the desktop app to submit them securely.')
  }

  private async plan(planPath: string, binding: ChannelBinding, adapter: PlatformAdapter): Promise<void> {
    const tokens = this.deps.planTokens
    if (!tokens || !supportsButtons(adapter)) {
      await this.sendText(adapter, binding, 'A plan is ready for review. Open the desktop app to inspect and approve it.')
      return
    }
    const content = this.deps.loadPlan?.(binding.sessionId, planPath) ?? ''
    const token = tokens.issue(binding.id, binding.sessionId, planPath)
    const buttons: InlineButton[] = [
      { id: `plan:accept:${token}`, label: 'Accept plan' },
      { id: `plan:compact:${token}`, label: 'Accept and compact' },
    ]
    const inline = content.length > 0 && content.length <= PLAN_INLINE_LIMIT
    const text = inline ? `Plan ready for review\n\n${content}` : 'Plan ready for review. The full plan is attached.'
    try {
      const sent = await adapter.sendButtons!(binding.channelId, text, buttons, opts(binding.threadId))
      const id = messageId(sent)
      if (id) this.deps.recordPlanMessage?.(binding, token, id)
      if (!inline && content && adapter.sendFile) await adapter.sendFile(binding.channelId, Buffer.from(content), 'plan.md', 'Full plan', opts(binding.threadId))
    } catch (error) {
      tokens.revoke(token)
      throw error
    }
  }

  private async error(error: unknown, binding: ChannelBinding, adapter: PlatformAdapter): Promise<void> {
    await this.sendText(adapter, binding, `Error: ${errorText(error)}`)
    this.reset(this.state(binding.id))
  }

  private async sendText(adapter: PlatformAdapter, binding: ChannelBinding, text: string): Promise<SentMessage | undefined> {
    let last: SentMessage | undefined
    for (const part of split(text, capability(adapter).maxMessageLength)) {
      const sent = await adapter.sendText(binding.channelId, part, opts(binding.threadId))
      if (sent) last = sent
    }
    return last
  }

  private reset(state: RenderState): void {
    state.streamingBuffer = ''
    state.finalBuffer = ''
    state.lastAssistantText = ''
    state.streamingMessageId = undefined
    state.progressMessageId = undefined
    state.progressStatus = undefined
    state.lastEditAt = 0
  }
}

export { MessagingRenderer as Renderer }

function resolveMode(mode: ResponseMode | undefined, legacy?: boolean): ResponseMode { return mode ?? (legacy === false ? 'final_only' : 'streaming') }
function opts(threadId?: number): SendOptions { return threadId === undefined ? {} : { threadId } }
function messageId(value: void | SentMessage): string | undefined { return value?.messageId }
function supportsEditing(adapter: PlatformAdapter): boolean { return adapter.capabilities?.messageEditing === true && typeof adapter.editMessage === 'function' }
function supportsButtons(adapter: PlatformAdapter): boolean { return adapter.capabilities?.inlineButtons === true && typeof adapter.sendButtons === 'function' }
function capability(adapter: PlatformAdapter): { maxMessageLength: number } { return { maxMessageLength: adapter.capabilities?.maxMessageLength ?? 30_000 } }
function bounded(text: string, adapter: PlatformAdapter): string { return text.slice(0, capability(adapter).maxMessageLength) }
function append(current: string, next: string): string { return current ? `${current}\n\n${next.trim()}` : next.trim() }
function split(text: string, limit: number): string[] { const value = text.trim(); if (!value) return []; const result: string[] = []; for (let offset = 0; offset < value.length; offset += limit) result.push(value.slice(offset, offset + limit)); return result }
function errorText(value: unknown): string { if (typeof value === 'string') return value; if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') return value.message; return 'The session could not continue.' }

import type { CreateSessionOptions, Message, Session } from '../../shared/types'

const DEFAULT_MAX_DRAFT_CHARS = 12_000
const MAX_MESSAGE_CHARS = 1_200

interface VisibleTranscriptEntry {
  role: 'user' | 'assistant'
  content: string
}

function truncateMessage(content: string): string {
  const characters = Array.from(content)
  if (characters.length <= MAX_MESSAGE_CHARS) return content
  return `${characters.slice(0, MAX_MESSAGE_CHARS).join('')}\n[This message was truncated]`
}

export function buildSafeContinuationDraft(
  messages: Message[],
  maxChars = DEFAULT_MAX_DRAFT_CHARS,
): string {
  const entries: VisibleTranscriptEntry[] = messages
    .filter((message): message is Message & { role: 'user' | 'assistant' } =>
      (message.role === 'user' || message.role === 'assistant')
      && !message.hidden
      && !message.isIntermediate
      && !message.isError
      && message.content.trim().length > 0,
    )
    .map(message => ({
      role: message.role,
      content: truncateMessage(message.content.trim()),
    }))

  const header = [
    'Continue the previous conversation using the visible transcript below.',
    'Internal thinking, tool calls, tool results, attachments, and error records were intentionally not copied.',
    '',
  ].join('\n')
  const footer = '\n\nWrite the next request below this line:\n'
  const omissionNotice = '[Earlier visible messages were omitted to keep the draft within the safe size limit.]\n\n'
  const budget = Math.max(0, maxChars - header.length - footer.length - omissionNotice.length)
  const selected: string[] = []
  let used = 0

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    const block = `[${entry.role === 'user' ? 'User' : 'Assistant'}]\n${entry.content}`
    const separatorLength = selected.length > 0 ? 2 : 0
    if (used + separatorLength + block.length > budget) break
    selected.unshift(block)
    used += separatorLength + block.length
  }

  const omitted = selected.length < entries.length
  const transcript = selected.join('\n\n')

  return `${header}${omitted ? omissionNotice : ''}${transcript}${footer}`
}

export function isAgentRouterContextRejection(message: Message): boolean {
  if (message.role !== 'error' || message.errorCode !== 'invalid_api_key') return false
  const text = `${message.errorOriginal ?? ''}\n${message.content}`.toLowerCase()
  return text.includes('401')
    || text.includes('unauthenticated')
    || text.includes('unauthorized client')
}

export function buildSafeContinuationSessionOptions(session: Session): CreateSessionOptions {
  return {
    name: `${session.name || 'Untitled'} (continued)`,
    llmConnection: session.llmConnection,
    model: session.model,
    permissionMode: session.permissionMode,
    thinkingLevel: 'off',
    workingDirectory: session.workingDirectory,
    enabledSourceSlugs: session.enabledSourceSlugs,
  }
}

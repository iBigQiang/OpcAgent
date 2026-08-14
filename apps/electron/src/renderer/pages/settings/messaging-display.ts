import { resolveEffectiveConnectionSlug } from '@config/llm-connections'

export interface DirectSessionDisplayInput {
  sessionLabel: string
  channelLabel?: string
  llmConnection?: string
  model?: string
  workspaceDefaultLlmConnection?: string
}

export interface MessagingConnectionDisplay {
  slug: string
  name: string
  providerType: string
  defaultModel?: string
  isDefault?: boolean
}

export function getDirectSessionDisplay(
  input: DirectSessionDisplayInput,
  connections: MessagingConnectionDisplay[],
): { title: string; details: string[] } {
  const connectionSlug = resolveEffectiveConnectionSlug(
    input.llmConnection,
    input.workspaceDefaultLlmConnection,
    connections,
  )
  const connection = connectionSlug
    ? connections.find((item) => item.slug === connectionSlug)
    : undefined
  const connectionLabel = connection
    ? `${connection.providerType} · ${connection.name}`
    : connectionSlug

  return {
    title: input.sessionLabel,
    details: [
      input.channelLabel ? `Telegram · ${input.channelLabel}` : undefined,
      connectionLabel,
      input.model ?? connection?.defaultModel,
    ].filter((value): value is string => Boolean(value)),
  }
}

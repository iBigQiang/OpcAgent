import type { LlmPlatformProfile } from '@config/llm-connections'

const PLATFORM_CONNECTION_DESCRIPTIONS: Readonly<Record<LlmPlatformProfile, string>> = {
  anyrouter: 'AnyRouter-CC · Claude Code CLI',
  anyrouter_pi: 'AnyRouter-Pi',
  agentrouter: 'AgentRouter · Pi Backend Compatible',
}

/** Returns the fixed runtime label for branded endpoint profiles. */
export function getPlatformConnectionDescription(platformProfile?: LlmPlatformProfile): string | undefined {
  return platformProfile ? PLATFORM_CONNECTION_DESCRIPTIONS[platformProfile] : undefined
}

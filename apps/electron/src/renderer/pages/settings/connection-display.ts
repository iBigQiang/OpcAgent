import type { LlmPlatformProfile } from '@config/llm-connections'

type Translate = (key: string) => string

const PLATFORM_CONNECTION_DESCRIPTION_KEYS: Readonly<Record<LlmPlatformProfile, string>> = {
  anyrouter: 'settings.ai.platform.anyrouter',
  anyrouter_pi: 'settings.ai.platform.anyrouterPi',
  agentrouter: 'settings.ai.platform.agentrouter',
}

/** Returns the fixed runtime label for branded endpoint profiles. */
export function getPlatformConnectionDescription(
  platformProfile: LlmPlatformProfile | undefined,
  t: Translate,
): string | undefined {
  return platformProfile ? t(PLATFORM_CONNECTION_DESCRIPTION_KEYS[platformProfile]) : undefined
}

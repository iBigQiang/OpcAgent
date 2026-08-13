import type { CustomEndpointApi, LlmPlatformProfile } from '@config/llm-connections'

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

/** Returns the localized protocol label shown beside an endpoint connection. */
export function getEndpointProtocolLabel(
  api: CustomEndpointApi | undefined,
  t: Translate,
): string | undefined {
  switch (api) {
    case 'openai-completions': return t('apiSetup.protocol.openAiChat')
    case 'openai-responses': return t('apiSetup.protocol.openAiResponses')
    case 'anthropic-messages': return t('apiSetup.protocol.anthropicMessages')
    case 'google-generative-ai': return t('apiSetup.protocol.googleGemini')
    default: return undefined
  }
}

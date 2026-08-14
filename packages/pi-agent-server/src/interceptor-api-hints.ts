export type InterceptorHintModel = {
  api?: string;
  provider?: string;
  baseUrl?: string;
};

/**
 * Keep interceptor routing hints in sync with the active Pi runtime.
 *
 * The platform profile must be cleared whenever the runtime switches away
 * from AnyRouter-Pi so the shared interceptor cannot retain a stale adapter.
 */
export function setInterceptorApiHints(
  model: InterceptorHintModel | undefined,
  platformProfile?: string,
  exactRequestUrl?: string,
): void {
  if (!model) {
    delete process.env.OPCAGENT_PI_MODEL_API;
    delete process.env.OPCAGENT_PI_MODEL_PROVIDER;
    delete process.env.OPCAGENT_PI_MODEL_BASE_URL;
    delete process.env.OPCAGENT_PLATFORM_PROFILE;
    delete process.env.OPCAGENT_EXACT_REQUEST_URL;
    return;
  }

  process.env.OPCAGENT_PI_MODEL_API = model.api || '';
  process.env.OPCAGENT_PI_MODEL_PROVIDER = model.provider || '';
  process.env.OPCAGENT_PI_MODEL_BASE_URL = model.baseUrl || '';
  if (exactRequestUrl?.trim()) {
    process.env.OPCAGENT_EXACT_REQUEST_URL = exactRequestUrl.trim();
  } else {
    delete process.env.OPCAGENT_EXACT_REQUEST_URL;
  }
  if (platformProfile) {
    process.env.OPCAGENT_PLATFORM_PROFILE = platformProfile;
  } else {
    delete process.env.OPCAGENT_PLATFORM_PROFILE;
  }
}

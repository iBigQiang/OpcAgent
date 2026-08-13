import type { ProviderDriver } from '../driver-types.ts';
import { normalizePlatformProfileBaseUrl } from '../../../../config/llm-connections.ts';

export function normalizeAnyRouterBaseUrl(value: string | undefined): string {
  return normalizePlatformProfileBaseUrl('anyrouter', value);
}

/** Runtime settings for the official Claude Code CLI backend. */
export const anthropicDriver: ProviderDriver = {
  provider: 'anthropic',
  buildRuntime: ({ context, resolvedPaths }) => {
    const platformProfile = context.connection?.platformProfile;
    return {
      baseUrl: platformProfile === 'anyrouter'
        ? normalizeAnyRouterBaseUrl(context.connection?.baseUrl)
        : context.connection?.baseUrl,
      platformProfile,
      paths: { claudeExecutable: resolvedPaths.claudeExecutablePath },
    };
  },
  validateStoredConnection: async ({ slug, credentialManager, resolvedPaths }) => {
    if (!resolvedPaths.claudeExecutablePath) {
      return { success: false, error: 'Native Claude Code claude.exe was not found or failed its --version check. Upgrade Claude Code, select bin\\claude.exe in OPCAgent settings, or add it to PATH.' };
    }
    const credential = await credentialManager.getLlmApiKey(slug);
    return credential
      ? { success: true }
      : { success: false, error: 'Could not retrieve credentials' };
  },
};

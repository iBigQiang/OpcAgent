export type CustomEndpointProviderId = 'custom-endpoint' | 'agentrouter';

/**
 * AgentRouter's Pi CLI models are registered under its own provider ID.
 * Generic custom endpoints intentionally retain the synthetic provider ID.
 */
export function resolveCustomEndpointProviderId(
  platformProfile?: string | null,
): CustomEndpointProviderId {
  return platformProfile === 'agentrouter' ? 'agentrouter' : 'custom-endpoint';
}

/**
 * Select the provider used for Pi model resolution and compatibility checks.
 * AgentRouter credentials are stored under the connection's selected protocol
 * provider, while its registered Pi models require the `agentrouter` alias.
 */
export function resolveCustomEndpointAuthProvider(
  platformProfile: string | null | undefined,
  piAuthProvider: string | undefined,
): string | undefined {
  return platformProfile === 'agentrouter' ? 'agentrouter' : piAuthProvider;
}

/**
 * Return all auth-storage keys that must receive an incoming credential.
 * The first key preserves the connection's existing storage mapping; the
 * AgentRouter alias lets Pi resolve the dynamically registered provider.
 */
export function resolveCustomEndpointCredentialProviders(
  platformProfile: string | null | undefined,
  piAuthProvider: string,
): string[] {
  const endpointProvider = resolveCustomEndpointProviderId(platformProfile);
  return endpointProvider === piAuthProvider
    ? [piAuthProvider]
    : [piAuthProvider, ...(endpointProvider === 'agentrouter' ? [endpointProvider] : [])];
}

export function isCustomEndpointModelProvider(
  provider: string | undefined,
  platformProfile?: string | null,
): boolean {
  return provider === resolveCustomEndpointProviderId(platformProfile);
}

export function isCompatibleCustomEndpointModelProvider(
  resolvedProvider: string | undefined,
  piAuthProvider: string | undefined,
  platformProfile?: string | null,
): boolean {
  return resolvedProvider === piAuthProvider
    || isCustomEndpointModelProvider(resolvedProvider, platformProfile);
}

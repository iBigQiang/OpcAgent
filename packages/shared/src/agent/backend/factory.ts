/**
 * Agent Factory
 *
 * Creates the appropriate AI agent based on configuration.
 * OPCAgent currently registers PiAgent only.
 *
 * All agents implement AgentBackend directly.
 *
 * LLM Connections:
 * - Backends can be created from LLM connection configs
 * - providerType determines SDK selection and credential routing
 * - authType determines how credentials are retrieved
 */

import type {
  AgentBackend,
  BackendConfig,
  AgentProvider,
  LlmProviderType,
  LlmAuthType,
  CoreBackendConfig,
  BackendHostRuntimeContext,
} from './types.ts';
import { PiAgent } from '../pi-agent.ts';
import { ClaudeCliAgent } from '../claude-cli-agent.ts';
import {
  getLlmConnection,
  getDefaultLlmConnection,
  type LlmConnection,
} from '../../config/storage.ts';
import type { CustomEndpointConfig } from '../../config/llm-connections.ts';
import { normalizeApiKeyInput } from '../../config/llm-connections.ts';
// Import validation helpers for provider-auth combinations
import {
  isValidProviderAuthCombination,
} from '../../config/llm-connections.ts';
import { parseValidationError, type LlmValidationResult } from '../../config/llm-validation.ts';
import type { ModelFetchResult } from '../../config/model-fetcher.ts';
// Model resolution utilities
import { getModelProvider, normalizeDeprecatedModelId } from '../../config/models.ts';
import { homedir } from 'node:os';
import { getCredentialManager } from '../../credentials/index.ts';
import type {
  BackendModelFetchCredentials,
  BackendProviderOptions,
  BackendResolutionContext,
  ProviderDriver,
  ResolvedBackendConfig,
  StoredConnectionValidationResult,
} from './internal/driver-types.ts';
import { getDefaultProviderType } from './internal/driver-types.ts';
import {
  resolveBackendHostTooling as resolveHostToolingPaths,
  resolveBackendRuntimePaths,
} from './internal/runtime-resolver.ts';
import { piDriver } from './internal/drivers/pi.ts';
import { anthropicDriver } from './internal/drivers/anthropic.ts';

const DRIVER_REGISTRY: Record<AgentProvider, ProviderDriver> = {
  anthropic: anthropicDriver,
  pi: piDriver,
};

const CUSTOM_ENDPOINT_CONNECTION_TEST_TIMEOUT_MS = 150_000;

function getProviderDriver(provider: AgentProvider): ProviderDriver {
  const driver = DRIVER_REGISTRY[provider];
  if (!driver) {
    throw new Error(`No backend driver registered for provider: ${provider}`);
  }
  return driver;
}

function resolveDriverRuntime(
  provider: AgentProvider,
  hostRuntime: BackendHostRuntimeContext,
) {
  const driver = getProviderDriver(provider);
  const resolvedPaths = resolveBackendRuntimePaths(hostRuntime);
  return { driver, resolvedPaths };
}

/**
 * Detect provider from stored auth type.
 *
 * The MVP has one backend, so every retained authentication type maps to Pi.
 *
 * @param authType - The stored authentication type
 * @returns The detected provider
 */
export function detectProvider(_authType: string): AgentProvider {
  return 'pi';
}

/**
 * Create the appropriate backend based on configuration.
 *
 * @param config - Backend configuration including provider selection
 * @returns An initialized AgentBackend instance
 * @throws Error if the requested provider is not yet implemented
 *
 * @example
 * ```typescript
 * const backend = createBackend({
 *   provider: 'pi',
 *   workspace: myWorkspace,
 * });
 * ```
 */
export function createBackend(config: BackendConfig): AgentBackend {
  switch (config.provider) {
    case 'anthropic':
      return new ClaudeCliAgent(config);
    case 'pi':
      // PiAgent implements AgentBackend directly
      // Auth is API key based via Pi's AuthStorage
      return new PiAgent(config);

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Create the appropriate agent based on configuration.
 * Alias for createBackend - prefer this name for new code.
 */
export const createAgent = createBackend;

/**
 * Create backend from a pre-resolved context and provider-agnostic core config.
 * Provider-specific runtime resolution happens via internal driver registry.
 */
export function createBackendFromResolvedContext(args: {
  context: ResolvedBackendContext;
  coreConfig: CoreBackendConfig;
  hostRuntime: BackendHostRuntimeContext;
  providerOptions?: BackendProviderOptions;
}): AgentBackend {
  const { context, coreConfig, hostRuntime, providerOptions } = args;
  const { driver, resolvedPaths } = resolveDriverRuntime(context.provider, hostRuntime);

  const buildArgs = {
    context,
    coreConfig,
    hostRuntime,
    resolvedPaths,
    providerOptions,
  };

  driver.prepareRuntime?.(buildArgs);
  const runtime = driver.buildRuntime(buildArgs);

  const config: ResolvedBackendConfig = {
    ...coreConfig,
    provider: context.provider,
    providerType: context.connection?.providerType ?? getDefaultProviderType(context.provider),
    authType: context.authType || getDefaultAuthType(context.provider),
    model: context.resolvedModel,
    connectionSlug: context.connection?.slug,
    runtime,
  };

  return createBackend(config);
}

/**
 * Initialize backend host runtime wiring once at app startup.
 * Keeps runtime/bootstrap details such as the Pi interceptor bundle
 * behind backend internals.
 */
export function initializeBackendHostRuntime(args: {
  hostRuntime: BackendHostRuntimeContext;
}): void {
  const { hostRuntime } = args;

  for (const provider of getAvailableProviders()) {
    const { driver, resolvedPaths } = resolveDriverRuntime(provider, hostRuntime);
    driver.initializeHostRuntime?.({ hostRuntime, resolvedPaths });
  }
}

/**
 * Resolve backend-managed host tooling paths (e.g. ripgrep) from generic host runtime metadata.
 */
export function resolveBackendHostTooling(args: {
  hostRuntime: BackendHostRuntimeContext;
}): {
  ripgrepPath?: string;
} {
  return resolveHostToolingPaths(args.hostRuntime);
}

/**
 * Get list of currently available providers.
 *
 * @returns Array of provider identifiers that have working implementations
 */
export function getAvailableProviders(): AgentProvider[] {
  return ['anthropic', 'pi'];
}

/**
 * Check if a provider is available for use.
 *
 * @param provider - Provider to check
 * @returns true if the provider has a working implementation
 */
export function isProviderAvailable(provider: AgentProvider): boolean {
  return getAvailableProviders().includes(provider);
}

// ============================================================
// LLM Connection Support
// ============================================================

/**
 * Map LlmProviderType to AgentProvider (SDK selection).
 *
 * AgentProvider determines which backend class to instantiate. The MVP maps
 * every retained connection type to PiAgent.
 *
 * @param providerType - The full provider type from LLM connection
 * @returns The agent provider for SDK selection
 */
export function providerTypeToAgentProvider(
  providerType: LlmProviderType,
  platformProfile?: LlmConnection['platformProfile'],
): AgentProvider {
  if (platformProfile === 'anyrouter') return 'anthropic';
  switch (providerType) {
    case 'pi':
    case 'pi_compat':
      return 'pi';

    default:
      // Exhaustive check
      const _exhaustive: never = providerType;
      return 'pi';
  }
}

/**
 * @deprecated Use LlmAuthType directly - no mapping needed.
 * Map legacy LLM auth type to backend auth type.
 *
 * @param authType - The legacy LLM connection auth type
 * @returns The corresponding backend auth type
 */
export function connectionAuthTypeToBackendAuthType(
  authType: LlmAuthType
): LlmAuthType | undefined {
  switch (authType) {
    case 'api_key':
    case 'api_key_with_endpoint':
    case 'oauth':
      // Pass through API-key auth types that Pi handles.
      return authType;
    case 'none':
      // These auth types don't require explicit credential passing
      return undefined;
  }
}

/**
 * Get LLM connection for a session.
 * Resolution order: session.llmConnection > workspace.defaults.defaultLlmConnection > global default
 *
 * @param sessionConnection - Connection slug from session (may be undefined)
 * @param workspaceDefaultConnection - Workspace default connection (may be undefined)
 * @returns The resolved LLM connection or null if not found
 */
export function resolveSessionConnection(
  sessionConnection?: string,
  workspaceDefaultConnection?: string
): LlmConnection | null {
  // 1. Session-level connection (locked after first message)
  if (sessionConnection) {
    const connection = getLlmConnection(sessionConnection);
    if (connection) return connection;
  }

  // 2. Workspace default
  if (workspaceDefaultConnection) {
    const connection = getLlmConnection(workspaceDefaultConnection);
    if (connection) return connection;
  }

  // 3. Global default
  const defaultSlug = getDefaultLlmConnection();
  if (!defaultSlug) return null;
  return getLlmConnection(defaultSlug);
}

/**
 * Provider-agnostic resolution result used by session/ipc orchestration.
 */
export interface ResolvedBackendContext extends BackendResolutionContext {}

/**
 * Resolve connection + provider/auth/model/capabilities in one call.
 * This keeps main-process orchestration free from provider-specific branching.
 */
export function resolveBackendContext(args: {
  sessionConnectionSlug?: string;
  workspaceDefaultConnectionSlug?: string;
  managedModel?: string;
}): ResolvedBackendContext {
  const connection = resolveSessionConnection(
    args.sessionConnectionSlug,
    args.workspaceDefaultConnectionSlug
  );

  const provider = connection
    ? providerTypeToAgentProvider(connection.providerType || 'pi', connection.platformProfile)
    : 'pi';

  const authType = connection
    ? connectionAuthTypeToBackendAuthType(connection.authType)
    : undefined;

  const resolvedModel = resolveModelForProvider(provider, args.managedModel, connection);

  return {
    connection,
    provider,
    authType,
    resolvedModel,
    capabilities: BACKEND_CAPABILITIES[provider],
  };
}

/**
 * Resolve provider hint for setup-time connection tests.
 * Keeps provider-specific hint mapping out of Electron main IPC handlers.
 */
export function resolveSetupTestConnectionHint(args: {
  provider: AgentProvider;
  baseUrl?: string;
  piAuthProvider?: string;
  customEndpoint?: CustomEndpointConfig;
  platformProfile?: LlmConnection['platformProfile'];
}): Pick<LlmConnection, 'providerType' | 'piAuthProvider' | 'customEndpoint' | 'platformProfile'> {
  if (args.provider === 'pi') {
    if (args.customEndpoint && args.baseUrl?.trim()) {
      return {
        providerType: 'pi_compat',
        piAuthProvider: args.customEndpoint.api === 'anthropic-messages' ? 'anthropic' : 'openai',
        customEndpoint: args.customEndpoint,
        ...(args.platformProfile ? { platformProfile: args.platformProfile } : {}),
      };
    }

    return {
      providerType: 'pi',
      piAuthProvider: args.piAuthProvider,
    };
  }

  return { providerType: 'pi' };
}

/**
 * Provider-agnostic model discovery for model refresh flows.
 * Dispatches to provider drivers and keeps provider-specific SDK usage internal.
 */
export async function fetchBackendModels(args: {
  connection: LlmConnection;
  credentials: BackendModelFetchCredentials;
  hostRuntime: BackendHostRuntimeContext;
  timeoutMs?: number;
}): Promise<ModelFetchResult> {
  const provider = providerTypeToAgentProvider(args.connection.providerType, args.connection.platformProfile);
  const { driver, resolvedPaths } = resolveDriverRuntime(provider, args.hostRuntime);
  const timeoutMs = args.timeoutMs ?? 30_000;

  driver.initializeHostRuntime?.({
    hostRuntime: args.hostRuntime,
    resolvedPaths,
  });

  if (!driver.fetchModels) {
    throw new Error(`Model discovery not implemented for provider: ${provider}`);
  }

  return driver.fetchModels({
    connection: args.connection,
    credentials: args.credentials,
    hostRuntime: args.hostRuntime,
    resolvedPaths,
    timeoutMs,
  });
}

/**
 * Provider-agnostic stored-connection validation.
 * Moves provider/auth branching out of Electron main IPC handlers.
 */
export async function validateStoredBackendConnection(args: {
  slug: string;
  hostRuntime: BackendHostRuntimeContext;
}): Promise<StoredConnectionValidationResult> {
  try {
    const connection = getLlmConnection(args.slug);
    if (!connection) {
      return { success: false, error: 'Connection not found' };
    }

    const credentialManager = getCredentialManager();
    const hasCredentials = await credentialManager.hasLlmCredentials(
      args.slug,
      connection.authType,
    );

    if (!hasCredentials && connection.authType !== 'none') {
      return { success: false, error: 'No credentials configured' };
    }

    const provider = providerTypeToAgentProvider(connection.providerType, connection.platformProfile);
    const { driver, resolvedPaths } = resolveDriverRuntime(provider, args.hostRuntime);

    driver.initializeHostRuntime?.({
      hostRuntime: args.hostRuntime,
      resolvedPaths,
    });

    if (!driver.validateStoredConnection) {
      return { success: true };
    }

    return driver.validateStoredConnection({
      slug: args.slug,
      connection,
      credentialManager,
      hostRuntime: args.hostRuntime,
      resolvedPaths,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: parseValidationError(msg) };
  }
}

/**
 * Create backend configuration from an LLM connection.
 *
 * @param connection - The LLM connection config
 * @param baseConfig - Base backend config (workspace, session, etc.)
 * @returns Complete BackendConfig ready for createBackend()
 */
export function createConfigFromConnection(
  connection: LlmConnection,
  baseConfig: Omit<BackendConfig, 'provider' | 'authType' | 'providerType'>
): BackendConfig {
  const providerType = connection.providerType;
  const provider = providerTypeToAgentProvider(providerType, connection.platformProfile);

  return {
    ...baseConfig,
    provider,
    providerType,
    authType: connection.authType,
    connectionSlug: connection.slug,
    // Use connection's default model if no model specified in baseConfig
    model: baseConfig.model || connection.defaultModel,
  };
}

/**
 * Create backend from an LLM connection slug.
 *
 * @param connectionSlug - The LLM connection slug
 * @param baseConfig - Base backend config (workspace, session, etc.)
 * @returns An initialized AgentBackend instance
 * @throws Error if connection not found or has invalid provider-auth combination
 */
export function createBackendFromConnection(
  connectionSlug: string,
  baseConfig: Omit<BackendConfig, 'provider' | 'authType'>,
  hostRuntime?: BackendHostRuntimeContext,
  providerOptions?: BackendProviderOptions,
): AgentBackend {
  const connection = getLlmConnection(connectionSlug);
  if (!connection) {
    throw new Error(`LLM connection not found: ${connectionSlug}`);
  }

  // Validate provider-auth combination before creating backend
  // This catches invalid configurations early with a clear error message
  if (!isValidProviderAuthCombination(connection.providerType, connection.authType)) {
    throw new Error(
      `Invalid LLM connection configuration: provider '${connection.providerType}' ` +
      `does not support auth type '${connection.authType}'. ` +
      `Please update the connection settings for '${connection.name}'.`
    );
  }

  const context: ResolvedBackendContext = {
    connection,
    provider: providerTypeToAgentProvider(connection.providerType || 'pi', connection.platformProfile),
    authType: connectionAuthTypeToBackendAuthType(connection.authType),
    resolvedModel: resolveModelForProvider(
      providerTypeToAgentProvider(connection.providerType || 'pi', connection.platformProfile),
      baseConfig.model,
      connection
    ),
    capabilities: BACKEND_CAPABILITIES[providerTypeToAgentProvider(connection.providerType || 'pi', connection.platformProfile)],
  };

  if (hostRuntime) {
    return createBackendFromResolvedContext({
      context,
      coreConfig: baseConfig,
      hostRuntime,
      providerOptions,
    });
  }

  const config = createConfigFromConnection(connection, {
    ...baseConfig,
    model: context.resolvedModel,
  });
  return createBackend(config);
}

// ============================================================
// Backend Capabilities
// ============================================================

/**
 * Declarative capabilities for each backend provider.
 * Used by the session layer to make decisions without checking provider strings.
 */
export const BACKEND_CAPABILITIES: Record<AgentProvider, {
  /** Whether the backend needs an HTTP pool server. */
  needsHttpPoolServer: boolean;
}> = {
  anthropic: { needsHttpPoolServer: false },
  pi: { needsHttpPoolServer: false },
};

// ============================================================
// Auth Type Resolution
// ============================================================

/**
 * Get the default auth type for a provider when none is explicitly specified.
 *
 * - pi: 'api_key'
 */
export function getDefaultAuthType(provider: AgentProvider): LlmAuthType | undefined {
  switch (provider) {
    case 'anthropic': return 'api_key';
    case 'pi':        return 'api_key';
    default:          return undefined;
  }
}

// ============================================================
// Model Resolution
// ============================================================

/**
 * Resolve the model ID for a given provider, validating against the connection's model list.
 *
 * Pi falls back to an empty string so its runtime can select a model.
 *
 * @param provider - The agent provider
 * @param managedModel - The model stored on the session (user's choice)
 * @param connection - The LLM connection config (has defaultModel and models[])
 * @returns Resolved model ID string
 */
export function resolveModelForProvider(
  provider: AgentProvider,
  managedModel: string | undefined,
  connection: LlmConnection | null
): string {
  // Cross-provider guard: if the model belongs to a different provider, fall back
  // to the connection's default so a model from another preset is not sent to Pi.
  if (managedModel) {
    managedModel = normalizeDeprecatedModelId(managedModel);
    const modelProvider = getModelProvider(managedModel);
    if (modelProvider && modelProvider !== provider) {
      managedModel = undefined; // Clear — will fall through to connection default
    }
  }

  let connectionDefault = connection?.defaultModel
    ? normalizeDeprecatedModelId(connection.defaultModel)
    : undefined;

  if (provider === 'pi' && connection?.models?.length) {
    const connectionModelIds = connection.models.map(m => typeof m === 'string' ? m : m.id);
    if (managedModel && !connectionModelIds.includes(managedModel)) {
      managedModel = undefined;
    }
    if (connectionDefault && !connectionModelIds.includes(connectionDefault)) {
      connectionDefault = connectionModelIds[0];
    }
  }

  switch (provider) {
    case 'anthropic':
    case 'pi':
      return managedModel || connectionDefault || '';
    default:
      return managedModel || connectionDefault || '';
  }
}

// ============================================================
// Provider-Agnostic Connection Testing
// ============================================================

export async function testBackendConnection(args: {
  provider: AgentProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  hostRuntime: BackendHostRuntimeContext;
  timeoutMs?: number;
  allowEmptyApiKey?: boolean;
  connection?: Pick<LlmConnection, 'providerType' | 'piAuthProvider' | 'customEndpoint' | 'platformProfile'>;
}): Promise<{ success: boolean; error?: string }> {
  let trimmedKey: string;
  try {
    trimmedKey = normalizeApiKeyInput(args.apiKey);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!trimmedKey && !args.allowEmptyApiKey) {
    return { success: false, error: 'API key is required' };
  }

  const tempSlug = `__test-${Date.now()}`;
  const cm = getCredentialManager();
  if (trimmedKey) {
    await cm.setLlmApiKey(tempSlug, trimmedKey);
  }

  try {
    const testModel = args.model;
    const provider = args.connection?.platformProfile === 'anyrouter' ? 'anthropic' : args.provider;
    const providerType = args.connection?.providerType ?? getDefaultProviderType(provider);
    const timeoutMs = args.timeoutMs
      ?? (providerType === 'pi_compat' ? CUSTOM_ENDPOINT_CONNECTION_TEST_TIMEOUT_MS : 20_000);
    const requiresFullPiProbe = providerType === 'pi_compat'
      && args.connection?.customEndpoint?.api === 'anthropic-messages';
    const now = Date.now();
    const authType: LlmAuthType = (
      providerType === 'pi_compat'
    )
      ? 'api_key_with_endpoint'
      : 'api_key';

    const syntheticConnection = {
      slug: tempSlug,
      name: 'Temporary Connection Test',
      providerType,
      authType,
      defaultModel: testModel,
      createdAt: now,
      piAuthProvider: args.connection?.piAuthProvider,
      customEndpoint: args.connection?.customEndpoint,
      ...(args.connection?.platformProfile ? { platformProfile: args.connection.platformProfile } : {}),
      ...(providerType === 'pi_compat' && testModel ? { models: [testModel] } : {}),
      ...(args.baseUrl?.trim() ? { baseUrl: args.baseUrl.trim() } : {}),
    } as LlmConnection;

    const context: ResolvedBackendContext = {
      connection: syntheticConnection,
      provider,
      authType,
      resolvedModel: testModel,
      capabilities: BACKEND_CAPABILITIES[provider],
    };

    const { driver, resolvedPaths } = resolveDriverRuntime(provider, args.hostRuntime);
    if (driver.testConnection && !requiresFullPiProbe) {
      const driverResult = await driver.testConnection({
        provider,
        apiKey: trimmedKey,
        model: testModel,
        baseUrl: args.baseUrl,
        connection: args.connection,
        hostRuntime: args.hostRuntime,
        resolvedPaths,
        timeoutMs,
      });
      // null = driver declined to handle; fall through to generic subprocess test
      if (driverResult !== null) return driverResult;
    }

    const cwd = homedir();
    const agent = createBackendFromResolvedContext({
      context,
      coreConfig: {
        workspace: { id: '__test', name: 'Connection Test', slug: '__test', rootPath: cwd, createdAt: 0 },
        session: { id: `test-${now}`, workspaceRootPath: cwd, createdAt: 0, lastUsedAt: 0 },
        isHeadless: true,
        miniModel: testModel,
        envOverrides: undefined,
      },
      hostRuntime: args.hostRuntime,
      providerOptions: { piAuthProvider: args.connection?.piAuthProvider },
    });

    const readAgentStderr = (): string => {
      const maybe = agent as unknown as { getRecentStderr?: () => string };
      return typeof maybe.getRecentStderr === 'function' ? maybe.getRecentStderr() : '';
    };
    const withStderrContext = (message: string): string => {
      const stderr = readAgentStderr();
      if (!stderr) return `${message} (subprocess produced no stderr output)`;
      return `${message}\n--- subprocess stderr (last ~8KB) ---\n${stderr}`;
    };

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(withStderrContext(`Connection test timed out after ${timeoutMs}ms`))),
          timeoutMs,
        );
      });
      const text = await Promise.race([
        agent.runMiniCompletion('Say ok'),
        timeoutPromise,
      ]);

      return text
        ? { success: true }
        : { success: false, error: 'No response from provider. Check your API key.' };
    } catch (error) {
      const base = error instanceof Error ? error.message : String(error);
      // Avoid double-appending if the timeout branch already included stderr context.
      const enriched = base.includes('subprocess stderr') ? base : withStderrContext(base);
      return { success: false, error: enriched };
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      agent.destroy();
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await cm.deleteLlmApiKey(tempSlug).catch(() => {});
  }
}

// ============================================================
// Connection Validation
// ============================================================

/**
 * Validate an LLM connection by dispatching to provider-specific validation.
 *
 * Pi providers validate on connect when no lightweight pre-flight check is available.
 *
 * For more thorough provider-specific validation (such as model list checks),
 * see the IPC handler in apps/electron/src/main/ipc.ts.
 *
 * @param connection - The LLM connection to validate
 * @param credentials - API key for validation
 * @returns Validation result
 */
export async function validateConnection(
  connection: LlmConnection,
  credentials: { apiKey?: string },
): Promise<LlmValidationResult> {
  const provider = providerTypeToAgentProvider(connection.providerType, connection.platformProfile);

  void provider;
  void credentials;
  return { success: true };
}

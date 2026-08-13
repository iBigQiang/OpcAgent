/** Named Pi provider and custom endpoint configurations. */

import type { ModelDefinition } from './models.ts';

type PiModelResolver = (piAuthProvider?: string) => ModelDefinition[];
let piModelResolver: PiModelResolver = () => [];

export function registerPiModelResolver(resolver: PiModelResolver): void {
  piModelResolver = resolver;
}

export type LlmProviderType = 'pi' | 'pi_compat';
export type LlmAuthType = 'api_key' | 'api_key_with_endpoint' | 'oauth' | 'none';
export type ModelSelectionMode = 'automaticallySyncedFromProvider' | 'userDefined3Tier';
export type CustomEndpointApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai';
export type LlmPlatformProfile = 'agentrouter' | 'anyrouter' | 'anyrouter_pi';
export type MidStreamBehavior = 'steer' | 'queue';

export interface NormalizedCustomEndpointUrl {
  baseUrl: string;
  requestPreviewUrl: string;
}

const CUSTOM_ENDPOINT_ERROR = 'Custom endpoint requires a valid HTTP(S) URL';
const CUSTOM_ENDPOINT_APIS = new Set<CustomEndpointApi>([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
]);

function trimTrailingSlashes(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

function appendPath(origin: string, pathname: string): string {
  const normalizedPath = trimTrailingSlashes(pathname);
  return normalizedPath === '/' ? origin : `${origin}${normalizedPath}`;
}

function appendToBasePath(pathname: string, suffix: string): string {
  const normalizedPath = trimTrailingSlashes(pathname);
  return normalizedPath === '/' ? suffix : `${normalizedPath}${suffix}`;
}

function removeTerminalPath(pathname: string, terminalPath: string): string {
  const normalizedPath = trimTrailingSlashes(pathname);
  return normalizedPath.endsWith(terminalPath)
    ? normalizedPath.slice(0, -terminalPath.length) || '/'
    : normalizedPath;
}

function removeKnownOperationPath(pathname: string): string {
  const withoutGemini = pathname.replace(/\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/, '') || '/';
  for (const terminalPath of ['/v1/chat/completions', '/chat/completions', '/v1/responses', '/responses', '/v1/messages', '/messages']) {
    const stripped = removeTerminalPath(withoutGemini, terminalPath);
    if (stripped !== withoutGemini) return stripped;
  }
  return withoutGemini;
}

function toEndpointUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new Error(CUSTOM_ENDPOINT_ERROR);

  const value = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(CUSTOM_ENDPOINT_ERROR);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(CUSTOM_ENDPOINT_ERROR);
  }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(CUSTOM_ENDPOINT_ERROR);
  }
  return parsed;
}

/** Maps a custom endpoint protocol to Pi's credential provider identifier. */
export function getPiAuthProviderForCustomEndpointApi(
  api: CustomEndpointApi,
): 'openai' | 'anthropic' | 'google' {
  switch (api) {
    case 'anthropic-messages': return 'anthropic';
    case 'google-generative-ai': return 'google';
    case 'openai-completions':
    case 'openai-responses': return 'openai';
    default: throw new Error(`Unsupported custom endpoint API: ${api as string}`);
  }
}

/**
 * Converts a user-supplied custom endpoint into the base URL expected by Pi's
 * selected protocol adapter, plus the effective request URL shown in setup UI.
 */
export function normalizeCustomEndpointUrl(
  api: CustomEndpointApi,
  input: string,
  modelId?: string,
): NormalizedCustomEndpointUrl {
  if (!CUSTOM_ENDPOINT_APIS.has(api)) {
    throw new Error(`Unsupported custom endpoint API: ${api as string}`);
  }
  const parsed = toEndpointUrl(input);
  const origin = parsed.origin;
  const pathname = trimTrailingSlashes(parsed.pathname);

  if (api === 'openai-completions' || api === 'openai-responses') {
    const operationPath = api === 'openai-completions' ? '/chat/completions' : '/responses';
    const withoutOperation = removeKnownOperationPath(pathname);
    const basePath = withoutOperation === '/' ? '/v1' : withoutOperation;
    const baseUrl = appendPath(origin, basePath);
    return { baseUrl, requestPreviewUrl: `${baseUrl}${operationPath}` };
  }

  if (api === 'anthropic-messages') {
    const withoutOperation = removeKnownOperationPath(pathname);
    const basePath = removeTerminalPath(withoutOperation, '/v1');
    const baseUrl = appendPath(origin, basePath);
    return { baseUrl, requestPreviewUrl: `${baseUrl}/v1/messages` };
  }

  const withoutOperation = removeKnownOperationPath(pathname);
  const withoutKnownVersion = removeTerminalPath(
    removeTerminalPath(withoutOperation, '/v1beta/models'),
    '/v1beta',
  );
  const basePrefix = removeTerminalPath(withoutKnownVersion, '/v1');
  const basePath = appendToBasePath(basePrefix, '/v1beta/models');
  const baseUrl = appendPath(origin, basePath);
  const encodedModelId = encodeURIComponent(modelId || '{modelId}');
  return {
    baseUrl,
    requestPreviewUrl: `${baseUrl}/${encodedModelId}:streamGenerateContent?alt=sse`,
  };
}

export function normalizePlatformProfileBaseUrl(
  platformProfile: LlmPlatformProfile,
  value: string | undefined,
): string {
  const errorMessage = `${platformProfile} profile requires a valid HTTPS endpoint`;
  if (!value?.trim()) throw new Error(errorMessage);

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(errorMessage);
  }

  const hasUnexpectedParts = parsed.protocol !== 'https:'
    || !parsed.hostname
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || Boolean(parsed.username || parsed.password || parsed.search || parsed.hash);
  if (hasUnexpectedParts) throw new Error(errorMessage);
  return parsed.origin;
}

export function normalizeApiKeyInput(value: string): string {
  const normalized = value.trim();
  if (normalized && !/^[\x21-\x7E]+$/.test(normalized)) {
    throw new Error(
      'API key contains invalid characters. Paste the raw key without labels, quotes, line breaks, or masked dots.',
    );
  }
  return normalized;
}

export interface CustomEndpointConfig {
  api: CustomEndpointApi;
  supportsImages?: boolean;
}

export interface LlmConnection {
  slug: string;
  name: string;
  providerType: LlmProviderType;
  baseUrl?: string;
  authType: LlmAuthType;
  models?: Array<ModelDefinition | string>;
  defaultModel?: string;
  modelSelectionMode?: ModelSelectionMode;
  piAuthProvider?: string;
  customEndpoint?: CustomEndpointConfig;
  platformProfile?: LlmPlatformProfile;
  midStreamBehavior?: MidStreamBehavior;
  oauthAccountUuid?: string;
  oauthAccountEmail?: string;
  oauthOrganizationUuid?: string;
  oauthOrganizationName?: string;
  oauthProfileVerifiedAt?: number;
  createdAt: number;
  lastUsedAt?: number;
}

export interface LlmConnectionWithStatus extends LlmConnection {
  isAuthenticated: boolean;
  authError?: string;
  isDefault?: boolean;
}

/**
 * Returns true when `modelId` must not be used as the mini/summarization model.
 * `codex-mini-latest` is always denied. ChatGPT subscription auth also rejects
 * every `*codex-mini*` variant, while regular OpenAI API keys remain unaffected.
 */
export function isDeniedMiniModelId(modelId: string, piAuthProvider?: string): boolean {
  const bare = modelId.startsWith('pi/') ? modelId.slice(3) : modelId;
  if (piAuthProvider === 'openai-codex' && bare.includes('codex-mini')) return true;
  return bare === 'codex-mini-latest';
}

function findSmallModel(
  connection: Pick<LlmConnection, 'models' | 'piAuthProvider'>,
): string | undefined {
  if (!connection.models?.length) return undefined;
  const idOf = (model: ModelDefinition | string): string =>
    typeof model === 'string' ? model : model.id;
  const searchText = (model: ModelDefinition | string): string =>
    typeof model === 'string'
      ? model.toLowerCase()
      : `${model.id} ${model.name} ${model.shortName}`.toLowerCase();
  const allowed = connection.models.filter(model => !isDeniedMiniModelId(idOf(model), connection.piAuthProvider));
  const preferred = allowed.find(model =>
    ['mini', 'haiku', 'flash'].some(keyword => searchText(model).includes(keyword))
  );
  const fallback = preferred ?? allowed.at(-1) ?? connection.models.at(-1);
  return fallback ? idOf(fallback) : undefined;
}

export function getMiniModel(
  connection: Pick<LlmConnection, 'models' | 'providerType' | 'piAuthProvider'>,
): string | undefined {
  return findSmallModel(connection);
}

export function getSummarizationModel(
  connection: Pick<LlmConnection, 'models' | 'providerType' | 'piAuthProvider'>,
): string | undefined {
  return findSmallModel(connection);
}

export function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug);
}

export function getLlmCredentialKey(slug: string): string {
  return `llm::${slug}::api_key`;
}

export type LlmCredentialStorageType = 'api_key' | 'oauth' | null;

export function authTypeToCredentialStorageType(authType: LlmAuthType): LlmCredentialStorageType {
  if (authType === 'none') return null;
  return authType === 'oauth' ? 'oauth' : 'api_key';
}

export function authTypeToCredentialType(authType: LlmAuthType): 'api_key' | 'oauth_token' | null {
  if (authType === 'oauth') return 'oauth_token';
  return authType === 'none' ? null : 'api_key';
}

export function authTypeRequiresEndpoint(authType: LlmAuthType): boolean {
  return authType === 'api_key_with_endpoint';
}

export function isCompatProvider(providerType: LlmProviderType): boolean {
  return providerType === 'pi_compat';
}

export function isLocalConnection(connection: Pick<LlmConnection, 'baseUrl'>): boolean {
  if (!connection.baseUrl?.trim()) return false;
  try {
    const hostname = new URL(connection.baseUrl.trim()).hostname.replace(/^\[|\]$/g, '');
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export function isPiProvider(providerType: LlmProviderType): boolean {
  return providerType === 'pi' || providerType === 'pi_compat';
}

export function defaultMidStreamBehavior(_providerType: LlmProviderType): MidStreamBehavior {
  return 'steer';
}

export function resolveMidStreamBehavior(
  connection: Pick<LlmConnection, 'midStreamBehavior' | 'providerType'>,
): MidStreamBehavior {
  return connection.midStreamBehavior === 'queue' || connection.midStreamBehavior === 'steer'
    ? connection.midStreamBehavior
    : defaultMidStreamBehavior(connection.providerType);
}

export function setModelSupportsImages(
  connection: LlmConnection,
  modelId: string,
  enabled: boolean,
): LlmConnection {
  if (!connection.models) return connection;
  const index = connection.models.findIndex(model =>
    (typeof model === 'string' ? model : model.id) === modelId
  );
  if (index < 0) return connection;
  const current = connection.models[index]!;
  const next = typeof current === 'string'
    ? ({ id: current, name: current, shortName: current, supportsImages: enabled } as ModelDefinition)
    : { ...current, supportsImages: enabled };
  const models = [...connection.models];
  models[index] = next;
  return { ...connection, models };
}

export function modelSupportsImages(
  connection: Pick<LlmConnection, 'providerType' | 'models' | 'customEndpoint'>,
  modelId: string,
): boolean {
  if (!isCompatProvider(connection.providerType)) return true;
  const model = connection.models?.find(candidate =>
    (typeof candidate === 'string' ? candidate : candidate.id) === modelId
  );
  if (model && typeof model !== 'string' && typeof model.supportsImages === 'boolean') {
    return model.supportsImages;
  }
  return connection.customEndpoint?.supportsImages ?? false;
}

export function getModelsForProviderType(
  providerType: LlmProviderType,
  piAuthProvider?: string,
): ModelDefinition[] {
  return providerType === 'pi' ? piModelResolver(piAuthProvider) : [];
}

export const PI_PREFERRED_DEFAULTS: Record<string, string[]> = {
  anthropic: [
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-sonnet-5',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ],
  'openai-codex': ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.2', 'gpt-5.1'],
  openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.2', 'gpt-5.1'],
  google: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-flash-preview'],
  deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash'],
};

export function getDefaultModelsForConnection(
  providerType: LlmProviderType,
  piAuthProvider?: string,
): Array<ModelDefinition | string> {
  if (providerType === 'pi_compat') return [];
  const models = [...piModelResolver(piAuthProvider)];
  const preferred = piAuthProvider ? PI_PREFERRED_DEFAULTS[piAuthProvider] ?? [] : [];
  const priority = (id: string): number => {
    const bare = id.startsWith('pi/') ? id.slice(3) : id;
    const index = preferred.findIndex(value => bare === value || bare.startsWith(`${value}-`));
    return index < 0 ? preferred.length : index;
  };
  return models.sort((a, b) => priority(a.id) - priority(b.id));
}

export function getDefaultModelForConnection(
  providerType: LlmProviderType,
  piAuthProvider?: string,
): string {
  const first = getDefaultModelsForConnection(providerType, piAuthProvider)[0];
  return typeof first === 'string' ? first : first?.id ?? '';
}

export function resolveEffectiveConnectionSlug(
  sessionConnection: string | undefined,
  workspaceDefault: string | undefined,
  connections: Pick<LlmConnectionWithStatus, 'slug' | 'isDefault'>[],
): string | undefined {
  return sessionConnection
    ?? workspaceDefault
    ?? connections.find(connection => connection.isDefault)?.slug
    ?? connections[0]?.slug;
}

export function isSessionConnectionUnavailable(
  sessionConnection: string | undefined,
  connections: Pick<LlmConnectionWithStatus, 'slug'>[],
): boolean {
  return Boolean(sessionConnection && !connections.some(connection => connection.slug === sessionConnection));
}

export function isValidProviderAuthCombination(
  providerType: LlmProviderType,
  authType: LlmAuthType,
): boolean {
  return providerType === 'pi'
    ? authType === 'api_key' || authType === 'oauth'
    : authType === 'api_key_with_endpoint' || authType === 'none';
}

import type { ProviderDriver, DriverTestConnectionArgs } from '../driver-types.ts';
import { getAllPiModels, getPiModelsForAuthProvider } from '../../../../config/models-pi.ts';
import { getPiProviderBaseUrl } from '../../../../config/models-pi.ts';
import { normalizePlatformProfileBaseUrl } from '../../../../config/llm-connections.ts';
import { adaptAnyRouterPiRequest, ANYROUTER_PI_PROFILE } from '../anyrouter-pi-wire.ts';

/**
 * Lightweight direct HTTP test for Pi providers that expose an Anthropic-compatible
 * messages endpoint. Avoids spawning a full Pi subprocess (which can exceed the
 * 20s test timeout due to SDK initialization overhead).
 */
async function testAnthropicCompatible(
  apiKey: string,
  baseUrl: string,
  model: string,
  timeoutMs: number,
  includeBearerAuth = false,
): Promise<{ success: boolean; error?: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        ...(includeBearerAuth ? { Authorization: `Bearer ${apiKey}` } : {}),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Say ok' }],
      }),
    });

    if (res.ok) return { success: true };

    const text = await res.text().catch(() => '');
    return { success: false, error: `${res.status} ${text}`.slice(0, 500) };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { success: false, error: 'Connection test timed out' };
    }
    return { success: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

async function testAnyRouterPiCompatible(
  apiKey: string,
  baseUrl: string,
  model: string,
  timeoutMs: number,
): Promise<{ success: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const request = adaptAnyRouterPiRequest({
      url: `${baseUrl}/v1/messages`,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: {
        model: model.startsWith('pi/') ? model.slice(3) : model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Say ok' }],
      },
      sessionId: crypto.randomUUID(),
      deviceId: crypto.randomUUID().replaceAll('-', ''),
    });
    const res = await fetch(request.url, {
      method: 'POST',
      signal: controller.signal,
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) return { success: false, error: `${res.status} ${text}`.slice(0, 500) };

    let sawMessageStop = false;
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try {
        const event = JSON.parse(line.slice(5).trim()) as {
          type?: string;
          error?: { type?: string; message?: string };
        };
        if (event.type === 'message_stop') sawMessageStop = true;
        if (event.type === 'error' || event.type === 'rate_limit') {
          const detail = event.error?.message || event.error?.type || event.type;
          return { success: false, error: detail.slice(0, 500) };
        }
      } catch {
        // Ignore non-JSON SSE lines such as keep-alive comments.
      }
    }
    return sawMessageStop
      ? { success: true }
      : { success: false, error: 'AnyRouter response ended without message_stop' };
  } catch (err) {
    if ((err as Error).name === 'AbortError') return { success: false, error: 'Connection test timed out' };
    return { success: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export const piDriver: ProviderDriver = {
  provider: 'pi',
  buildRuntime: ({ context, providerOptions, resolvedPaths }) => {
    const platformProfile = context.connection?.platformProfile;
    return {
      paths: {
        piServer: resolvedPaths.piServerPath,
        interceptor: resolvedPaths.interceptorBundlePath,
        node: resolvedPaths.nodeRuntimePath,
      },
      piAuthProvider: platformProfile === ANYROUTER_PI_PROFILE
        ? 'anthropic'
        : providerOptions?.piAuthProvider || context.connection?.piAuthProvider,
      baseUrl: platformProfile === ANYROUTER_PI_PROFILE
        ? normalizePlatformProfileBaseUrl(platformProfile, context.connection?.baseUrl)
        : context.connection?.baseUrl,
      platformProfile,
      customEndpoint: platformProfile === ANYROUTER_PI_PROFILE
        ? { api: 'anthropic-messages' }
        : context.connection?.customEndpoint,
      customModels: context.connection?.models?.map(m => {
        if (typeof m === 'string') return m;
        const supportsImages = typeof m.supportsImages === 'boolean'
          ? m.supportsImages
          : undefined;
        if (m.contextWindow || supportsImages !== undefined) {
          return {
            id: m.id,
            ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
            ...(supportsImages !== undefined ? { supportsImages } : {}),
          };
        }
        return m.id;
      }),
    };
  },
  fetchModels: async ({ connection, credentials, timeoutMs }) => {
    // Pi providers use the SDK model registry; custom endpoints supply models directly.
    const models = connection.piAuthProvider
      ? getPiModelsForAuthProvider(connection.piAuthProvider)
      : getAllPiModels();

    if (models.length === 0) {
      throw new Error(
        `No Pi models found for provider: ${connection.piAuthProvider ?? 'all'}`,
      );
    }

    return { models };
  },
  testConnection: async (args: DriverTestConnectionArgs): Promise<{ success: boolean; error?: string } | null> => {
    if (args.connection?.platformProfile === ANYROUTER_PI_PROFILE) {
      const baseUrl = normalizePlatformProfileBaseUrl(ANYROUTER_PI_PROFILE, args.baseUrl);
      return testAnyRouterPiCompatible(args.apiKey, baseUrl, args.model, args.timeoutMs);
    }
    const piAuthProvider = args.connection?.piAuthProvider;
    if (!piAuthProvider) {
      // No provider hint — fall back to generic subprocess path
      return null;
    }

    // Resolve the model's API type from the Pi SDK registry.
    // For anthropic-messages providers, do a lightweight direct HTTP test
    // instead of spawning a full Pi subprocess (which can exceed the timeout).
    let modelApi: string | undefined;
    let modelBaseUrl: string | undefined;
    try {
      const { getModels } = await import('@earendil-works/pi-ai/compat');
      const models = getModels(piAuthProvider as Parameters<typeof getModels>[0]);
      const requestedId = args.model.startsWith('pi/') ? args.model.slice(3) : args.model;
      const match = models.find(m => m.id === requestedId) || models[0];
      if (match) {
        modelApi = (match as { api?: string }).api;
        modelBaseUrl = (match as { baseUrl?: string }).baseUrl;
      }
    } catch { /* ignore — fall through to subprocess */ }

    if (modelApi !== 'anthropic-messages') {
      // Non-Anthropic API types need the full Pi SDK — let factory.ts handle it
      return null;
    }

    const baseUrl = args.baseUrl?.trim() || modelBaseUrl || getPiProviderBaseUrl(piAuthProvider);
    if (!baseUrl) {
      return { success: false, error: 'Could not determine API endpoint for provider' };
    }

    // Strip Pi SDK's 'pi/' prefix — Anthropic-compatible endpoints only accept bare model IDs
    let bareModel = args.model.startsWith('pi/') ? args.model.slice(3) : args.model;
    // MiniMax CN API doesn't accept the 'MiniMax-' prefix on model names
    if (piAuthProvider === 'minimax-cn' && bareModel.startsWith('MiniMax-')) {
      bareModel = bareModel.slice('MiniMax-'.length);
    }
    const isCustomAnthropicEndpoint = args.connection?.providerType === 'pi_compat'
      && args.connection.customEndpoint?.api === 'anthropic-messages';
    return testAnthropicCompatible(
      args.apiKey,
      baseUrl,
      bareModel,
      args.timeoutMs,
      isCustomAnthropicEndpoint,
    );
  },
  validateStoredConnection: async ({ connection }) => {
    if (connection.platformProfile === ANYROUTER_PI_PROFILE) {
      normalizePlatformProfileBaseUrl(connection.platformProfile, connection.baseUrl);
    }
    return { success: true };
  },
};

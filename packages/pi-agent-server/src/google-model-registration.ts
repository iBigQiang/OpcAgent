import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRegistry as PiModelRegistry } from '@earendil-works/pi-coding-agent';
import { GOOGLE_MODEL_CATALOG_ADDITIONS } from '../../shared/src/config/google-model-catalog.ts';

/**
 * Register the current Google catalog without losing Pi's built-in models.
 * ModelRegistry.registerProvider replaces a provider, so the full merged list
 * must be supplied in one call.
 */
export function registerGoogleModelCatalog(
  registry: PiModelRegistry,
  apiKey: string,
): void {
  const currentModels = registry.getAll().filter(model => model.provider === 'google');
  const byId = new Map(currentModels.map(model => [model.id, model]));
  for (const model of GOOGLE_MODEL_CATALOG_ADDITIONS) {
    if (!byId.has(model.id)) byId.set(model.id, model as Model<Api>);
  }

  registry.registerProvider('google', {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey,
    api: 'google-generative-ai',
    models: [...byId.values()].map(model => ({
      id: model.id,
      name: model.name,
      api: model.api,
      baseUrl: model.baseUrl,
      reasoning: model.reasoning,
      thinkingLevelMap: model.thinkingLevelMap,
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      compat: model.compat,
    })),
  });
}

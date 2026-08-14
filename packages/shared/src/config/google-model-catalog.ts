import type { Model } from '@earendil-works/pi-ai';

/**
 * Google models released after the Pi 0.80.x catalog bundled with OPC Agent.
 *
 * Keep this compatibility list limited to stable, general-purpose models that
 * are documented by Google and supported by the generateContent API. The Pi
 * runtime merges these entries with its built-in Google catalog.
 */
export const GOOGLE_MODEL_CATALOG_ADDITIONS = [
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite',
    api: 'google-generative-ai',
    provider: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    reasoning: true,
    thinkingLevelMap: { off: null },
    input: ['text', 'image'],
    cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    api: 'google-generative-ai',
    provider: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    reasoning: true,
    thinkingLevelMap: { off: null },
    input: ['text', 'image'],
    // Google introductory pricing through 2026-12-31.
    cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    api: 'google-generative-ai',
    provider: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    reasoning: true,
    // Gemini 3.7 does not support the older MINIMAL thinking level.
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: 'LOW',
      medium: 'MEDIUM',
      high: 'HIGH',
      xhigh: 'HIGH',
      max: 'HIGH',
    },
    input: ['text', 'image'],
    // Google introductory pricing through 2026-12-31.
    cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
] satisfies readonly Model<'google-generative-ai'>[];

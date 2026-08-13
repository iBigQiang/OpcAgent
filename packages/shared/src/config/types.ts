/**
 * Config Types (Browser-safe)
 *
 * Pure type definitions for configuration.
 * Re-exports from @opcagent/core for compatibility.
 */

// Re-export all config types from core (single source of truth)
export type {
  Workspace,
} from '@opcagent/core/types';

/** App-level network proxy configuration. */
export interface NetworkProxySettings {
  enabled: boolean;
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

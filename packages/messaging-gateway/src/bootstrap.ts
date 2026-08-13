import { MessagingGatewayRegistry, type MessagingGatewayRegistryOptions } from './registry'
/** Host-facing bootstrap kept deliberately small: main owns wiring and calls dispose during shutdown. */
export function createMessagingBootstrap(options: MessagingGatewayRegistryOptions): { registry: MessagingGatewayRegistry; dispose(): Promise<void> } { const registry = new MessagingGatewayRegistry(options); return { registry, dispose: () => registry.dispose() } }

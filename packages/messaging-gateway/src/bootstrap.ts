import type { PushTarget } from '@mkagent/shared/protocol'
import { createFanOutSink } from './event-fanout'
import { MessagingGatewayRegistry, type MessagingGatewayRegistryOptions } from './registry'

export type PublishEventFn = (channel: string, target: PushTarget, ...args: unknown[]) => void
export type EventSink = (channel: string, target: PushTarget, ...args: any[]) => void
export interface MessagingBootstrapHandle {
  readonly registry: MessagingGatewayRegistry
  setPublisher(publish: PublishEventFn): void
  wrapSink(baseSink: EventSink): EventSink
  initializeWorkspaces(workspaceIds: string[]): Promise<void>
  dispose(): Promise<void>
}

/** Shared host lifecycle. Hosts only provide dependencies and call these four methods. */
export function createMessagingBootstrap(options: MessagingGatewayRegistryOptions): MessagingBootstrapHandle {
  const registry = new MessagingGatewayRegistry(options)
  return {
    registry,
    setPublisher(publish) {
      registry.setPublisher((channel, workspaceId, payload) => publish(channel, { to: 'workspace', workspaceId }, ...(payload === undefined ? [] : [payload])))
    },
    wrapSink(baseSink) {
      return createFanOutSink(baseSink, registry.onSessionEvent as EventSink)
    },
    async initializeWorkspaces(workspaceIds) {
      for (const workspaceId of workspaceIds) await registry.initializeWorkspace(workspaceId)
    },
    dispose: () => registry.stopAll(),
  }
}

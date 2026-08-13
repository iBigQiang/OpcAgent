import type { BindingAccessMode, LarkCredentials, MessagingConfig, PlatformType } from '@mkagent/messaging-gateway'
import type { RpcServer } from '@mkagent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { IMessagingGatewayRegistry } from '../messaging-registry-interface'
import { RPC_CHANNELS } from '@mkagent/shared/protocol'

const CHANNEL = {
  getConfig: RPC_CHANNELS.messaging.GET_CONFIG,
  updateConfig: RPC_CHANNELS.messaging.UPDATE_CONFIG,
  getBindings: RPC_CHANNELS.messaging.GET_BINDINGS,
  bind: RPC_CHANNELS.messaging.BIND,
  unbindBinding: RPC_CHANNELS.messaging.UNBIND_BINDING,
  setBindingAccess: RPC_CHANNELS.messaging.SET_BINDING_ACCESS,
  getRuntime: RPC_CHANNELS.messaging.GET_RUNTIME,
  saveCredential: RPC_CHANNELS.messaging.SAVE_CREDENTIAL,
  forgetCredential: RPC_CHANNELS.messaging.FORGET_CREDENTIAL,
  testTelegram: RPC_CHANNELS.messaging.TEST_TELEGRAM,
  testLark: RPC_CHANNELS.messaging.TEST_LARK,
  connect: RPC_CHANNELS.messaging.CONNECT,
  disconnect: RPC_CHANNELS.messaging.DISCONNECT,
  setOwners: RPC_CHANNELS.messaging.SET_PLATFORM_OWNERS,
  setMode: RPC_CHANNELS.messaging.SET_PLATFORM_ACCESS_MODE,
  getOwners: RPC_CHANNELS.messaging.GET_PLATFORM_OWNERS,
  getMode: RPC_CHANNELS.messaging.GET_PLATFORM_ACCESS_MODE,
  getPending: RPC_CHANNELS.messaging.GET_PENDING_SENDERS,
  dismissPending: RPC_CHANNELS.messaging.DISMISS_PENDING_SENDER,
  allowPending: RPC_CHANNELS.messaging.ALLOW_PENDING_SENDER,
} as const

export const HANDLED_CHANNELS = Object.values(CHANNEL)

export function registerMessagingHandlers(server: RpcServer, deps: HandlerDeps & { messagingRegistry?: IMessagingGatewayRegistry }): void {
  const registry = deps.messagingRegistry
  if (!registry) return
  const workspaceId = (value: string | null): string => { if (!value) throw new Error('Workspace context is required'); return value }
  server.handle(CHANNEL.getConfig, async ctx => registry.getConfig(workspaceId(ctx.workspaceId)))
  server.handle(CHANNEL.updateConfig, async (ctx, patch: Partial<MessagingConfig>) => registry.updateConfig(workspaceId(ctx.workspaceId), patch))
  server.handle(CHANNEL.getBindings, async ctx => registry.getBindings(workspaceId(ctx.workspaceId)))
  server.handle(CHANNEL.bind, async (ctx, input) => registry.bind(workspaceId(ctx.workspaceId), input as Parameters<IMessagingGatewayRegistry['bind']>[1]))
  server.handle(CHANNEL.unbindBinding, async (ctx, bindingId: string) => ({ success: registry.unbindBinding(workspaceId(ctx.workspaceId), bindingId) }))
  server.handle(CHANNEL.setBindingAccess, async (ctx, bindingId: string, accessMode: BindingAccessMode, allowedSenderIds?: string[]) => registry.setBindingAccess(workspaceId(ctx.workspaceId), bindingId, accessMode, allowedSenderIds))
  server.handle(CHANNEL.getRuntime, async ctx => registry.getRuntime(workspaceId(ctx.workspaceId)))
  server.handle(CHANNEL.saveCredential, async (ctx, platform: PlatformType, value: string) => { await registry.saveCredential(workspaceId(ctx.workspaceId), platform, value); return { success: true } })
  server.handle(CHANNEL.forgetCredential, async (ctx, platform: PlatformType) => { await registry.forgetCredential(workspaceId(ctx.workspaceId), platform); return { success: true } })
  server.handle(CHANNEL.testTelegram, async (_ctx, token: string) => registry.testTelegramToken(token))
  server.handle(CHANNEL.testLark, async (_ctx, credentials: LarkCredentials) => registry.testLarkCredentials(credentials))
  server.handle(CHANNEL.connect, async (ctx, platform: PlatformType) => { const id = workspaceId(ctx.workspaceId); await registry.connect(id, platform); return registry.getRuntime(id) })
  server.handle(CHANNEL.disconnect, async (ctx, platform: PlatformType) => { const id = workspaceId(ctx.workspaceId); await registry.disconnect(id, platform); return registry.getRuntime(id) })
  server.handle(CHANNEL.setOwners, async (ctx, platform: PlatformType, ownerIds: string[]) => registry.setPlatformOwners(workspaceId(ctx.workspaceId), platform, ownerIds))
  server.handle(CHANNEL.setMode, async (ctx, platform: PlatformType, mode: 'open' | 'owner-only') => registry.setPlatformAccessMode(workspaceId(ctx.workspaceId), platform, mode))
  server.handle(CHANNEL.getOwners, async (ctx, platform: PlatformType) => registry.getPlatformOwners(workspaceId(ctx.workspaceId), platform))
  server.handle(CHANNEL.getMode, async (ctx, platform: PlatformType) => registry.getPlatformAccessMode(workspaceId(ctx.workspaceId), platform))
  server.handle(CHANNEL.getPending, async (ctx, platform?: PlatformType) => registry.getPendingSenders(workspaceId(ctx.workspaceId), platform))
  server.handle(CHANNEL.dismissPending, async (ctx, platform: PlatformType, senderId: string) => ({ success: registry.dismissPendingSender(workspaceId(ctx.workspaceId), platform, senderId) }))
  server.handle(CHANNEL.allowPending, async (ctx, platform: PlatformType, senderId: string) => registry.allowPendingSender(workspaceId(ctx.workspaceId), platform, senderId))
}

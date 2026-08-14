import type { BindingAccessMode, LarkCredentials, MessagingConfig, PlatformType } from '@opcagent/messaging-gateway'
import { RPC_CHANNELS } from '@opcagent/shared/protocol'
import type { RpcServer } from '@opcagent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { IMessagingGatewayRegistry, MessagingPendingEntryKey, MessagingPlatformOwnerInfo } from '../messaging-registry-interface'

const CHANNEL = {
  getConfig: RPC_CHANNELS.messaging.GET_CONFIG,
  updateConfig: RPC_CHANNELS.messaging.UPDATE_CONFIG,
  getBindings: RPC_CHANNELS.messaging.GET_BINDINGS,
  bind: RPC_CHANNELS.messaging.BIND,
  unbindBinding: RPC_CHANNELS.messaging.UNBIND_BINDING,
  unbindSession: RPC_CHANNELS.messaging.UNBIND,
  generateCode: RPC_CHANNELS.messaging.GENERATE_CODE,
  generateOwnerCode: RPC_CHANNELS.messaging.GENERATE_OWNER_CODE,
  generateSupergroupCode: RPC_CHANNELS.messaging.GENERATE_SUPERGROUP_CODE,
  getSupergroup: RPC_CHANNELS.messaging.GET_SUPERGROUP,
  unbindSupergroup: RPC_CHANNELS.messaging.UNBIND_SUPERGROUP,
  setBindingAccess: RPC_CHANNELS.messaging.SET_BINDING_ACCESS,
  getRuntime: RPC_CHANNELS.messaging.GET_RUNTIME,
  saveCredential: RPC_CHANNELS.messaging.SAVE_CREDENTIAL,
  forgetCredential: RPC_CHANNELS.messaging.FORGET_CREDENTIAL,
  saveTelegram: RPC_CHANNELS.messaging.SAVE_TELEGRAM,
  saveLark: RPC_CHANNELS.messaging.SAVE_LARK,
  forget: RPC_CHANNELS.messaging.FORGET,
  testTelegram: RPC_CHANNELS.messaging.TEST_TELEGRAM,
  testLark: RPC_CHANNELS.messaging.TEST_LARK,
  connect: RPC_CHANNELS.messaging.CONNECT,
  disconnect: RPC_CHANNELS.messaging.DISCONNECT,
  waStartConnect: RPC_CHANNELS.messaging.WA_START_CONNECT,
  waSubmitPhone: RPC_CHANNELS.messaging.WA_SUBMIT_PHONE,
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
  const workspaceId = (value: string | null): string => {
    if (!value) throw new Error('Workspace context is required')
    return value
  }
  server.handle(CHANNEL.getConfig, async ctx => { const id = workspaceId(ctx.workspaceId); return { ...registry.getConfig(id), runtime: Object.fromEntries(registry.getRuntime(id).map(value => [value.platform, value])) } })
  server.handle(CHANNEL.updateConfig, async (ctx, patch: Partial<MessagingConfig>) => registry.updateConfig(workspaceId(ctx.workspaceId), patch))
  server.handle(CHANNEL.getBindings, async ctx => registry.getBindings(workspaceId(ctx.workspaceId)))
  server.handle(CHANNEL.bind, async (ctx, input) => registry.bind(workspaceId(ctx.workspaceId), input as Parameters<IMessagingGatewayRegistry['bind']>[1]))
  server.handle(CHANNEL.unbindBinding, async (ctx, bindingId: string) => ({ success: registry.unbindBinding(workspaceId(ctx.workspaceId), bindingId) }))
  server.handle(CHANNEL.unbindSession, async (ctx, sessionId: string, platform?: PlatformType) => ({ success: registry.unbindSession(workspaceId(ctx.workspaceId), sessionId, platform) > 0 }))
  server.handle(CHANNEL.generateCode, async (ctx, sessionId: string, platform: PlatformType) => registry.generatePairingCode(workspaceId(ctx.workspaceId), sessionId, platform))
  server.handle(CHANNEL.generateOwnerCode, async (ctx, platform: 'telegram') => registry.generateOwnerPairingCode(workspaceId(ctx.workspaceId), platform))
  server.handle(CHANNEL.generateSupergroupCode, async (ctx, platform: 'telegram') => registry.generateSupergroupPairingCode(workspaceId(ctx.workspaceId), platform))
  server.handle(CHANNEL.getSupergroup, async ctx => registry.getWorkspaceSupergroup(workspaceId(ctx.workspaceId)))
  server.handle(CHANNEL.unbindSupergroup, async ctx => { await registry.unbindWorkspaceSupergroup(workspaceId(ctx.workspaceId)); return { success: true } })
  server.handle(CHANNEL.setBindingAccess, async (ctx, bindingId: string, access: { mode: BindingAccessMode; allowedSenderIds?: string[] }) => {
    registry.setBindingAccess(workspaceId(ctx.workspaceId), bindingId, access)
    return { success: true }
  })
  server.handle(CHANNEL.getRuntime, async ctx => registry.getRuntime(workspaceId(ctx.workspaceId)))
  server.handle(CHANNEL.saveCredential, async () => { throw new Error('Generic messaging credentials are not supported') })
  server.handle(CHANNEL.forgetCredential, async () => { throw new Error('Generic messaging credentials are not supported') })
  server.handle(CHANNEL.saveTelegram, async (ctx, token: string) => { await registry.saveTelegramToken(workspaceId(ctx.workspaceId), token); return { success: true } })
  server.handle(CHANNEL.saveLark, async (ctx, credentials: LarkCredentials) => { await registry.saveLarkCredentials(workspaceId(ctx.workspaceId), credentials); return { success: true } })
  server.handle(CHANNEL.forget, async (ctx, platform: PlatformType) => { await registry.forgetPlatform(workspaceId(ctx.workspaceId), platform); return { success: true } })
  server.handle(CHANNEL.testTelegram, async (_ctx, token: string) => registry.testTelegramToken(token))
  server.handle(CHANNEL.testLark, async (_ctx, credentials: LarkCredentials) => registry.testLarkCredentials(credentials))
  server.handle(CHANNEL.connect, async () => { throw new Error('Use platform credential setup to connect messaging') })
  server.handle(CHANNEL.disconnect, async (ctx, platform: PlatformType) => { const id = workspaceId(ctx.workspaceId); await registry.disconnectPlatform(id, platform); return { success: true } })
  server.handle(CHANNEL.waStartConnect, async ctx => { await registry.startWhatsAppConnect(workspaceId(ctx.workspaceId)); return { success: true } })
  server.handle(CHANNEL.waSubmitPhone, async (ctx, phoneNumber: string) => { await registry.submitWhatsAppPhone(workspaceId(ctx.workspaceId), phoneNumber); return { success: true } })
  server.handle(CHANNEL.setOwners, async (ctx, platform: PlatformType, owners: MessagingPlatformOwnerInfo[]) => registry.setPlatformOwners(workspaceId(ctx.workspaceId), platform, owners))
  server.handle(CHANNEL.setMode, async (ctx, platform: PlatformType, mode: 'open' | 'owner-only') => registry.setPlatformAccessMode(workspaceId(ctx.workspaceId), platform, mode))
  server.handle(CHANNEL.getOwners, async (ctx, platform: PlatformType) => registry.getPlatformOwners(workspaceId(ctx.workspaceId), platform))
  server.handle(CHANNEL.getMode, async (ctx, platform: PlatformType) => registry.getPlatformAccessMode(workspaceId(ctx.workspaceId), platform))
  server.handle(CHANNEL.getPending, async (ctx, platform?: PlatformType) => registry.getPendingSenders(workspaceId(ctx.workspaceId), platform))
  server.handle(CHANNEL.dismissPending, async (ctx, platform: PlatformType, senderId: string, entryKey: MessagingPendingEntryKey) => {
    if (!entryKey || !entryKey.reason || (entryKey.reason === 'not-on-binding-allowlist' && !entryKey.bindingId)) throw new Error('A precise pending sender key is required')
    return { success: registry.dismissPendingSender(workspaceId(ctx.workspaceId), platform, senderId, entryKey) }
  })
  server.handle(CHANNEL.allowPending, async (ctx, platform: PlatformType, senderId: string, entryKey: MessagingPendingEntryKey) => {
    if (!entryKey || !entryKey.reason || (entryKey.reason === 'not-on-binding-allowlist' && !entryKey.bindingId)) throw new Error('A precise pending sender key is required')
    return registry.allowPendingSender(workspaceId(ctx.workspaceId), platform, senderId, entryKey)
  })
}

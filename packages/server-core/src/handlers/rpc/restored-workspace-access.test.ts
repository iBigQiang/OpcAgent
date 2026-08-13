import { describe, expect, test } from 'bun:test'
import { RPC_CHANNELS } from '@opcagent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@opcagent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerAutomationsHandlers } from './automations'
import { registerLabelsHandlers } from './labels'
import { registerProjectsHandlers } from './projects'

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps = {
    sessionManager: {},
    oauthFlowStore: {},
    platform: {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  } as unknown as HandlerDeps
  registerProjectsHandlers(server, deps)
  registerLabelsHandlers(server, deps)
  registerAutomationsHandlers(server, deps)
  return handlers
}

const ctx: RequestContext = {
  clientId: 'client-one',
  workspaceId: 'workspace-one',
  webContentsId: null,
}

describe('restored feature workspace access', () => {
  test.each([
    [RPC_CHANNELS.projects.GET, ['workspace-two']],
    [RPC_CHANNELS.labels.LIST, ['workspace-two']],
    [RPC_CHANNELS.automations.GET, ['workspace-two']],
    [RPC_CHANNELS.automations.TEST, [{ workspaceId: 'workspace-two', actions: [] }]],
  ] as const)('%s rejects a workspace outside the authenticated context', async (channel, args) => {
    const handler = createHarness().get(channel)
    expect(handler).toBeDefined()
    await expect(handler!(ctx, ...args)).rejects.toThrow('Workspace context mismatch')
  })

  test.each([
    [RPC_CHANNELS.projects.GET, ['workspace-one']],
    [RPC_CHANNELS.labels.LIST, ['workspace-one']],
    [RPC_CHANNELS.automations.GET, ['workspace-one']],
  ] as const)('%s rejects requests without an authenticated workspace', async (channel, args) => {
    const handler = createHarness().get(channel)
    expect(handler).toBeDefined()
    await expect(handler!({ ...ctx, workspaceId: null }, ...args)).rejects.toThrow('Workspace context mismatch')
  })
})

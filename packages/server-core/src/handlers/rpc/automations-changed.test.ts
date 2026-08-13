import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@opcagent/shared/config'
import { RPC_CHANNELS } from '@opcagent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@opcagent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerAutomationsHandlers } from './automations'

const ctx: RequestContext = { clientId: 'client-one', workspaceId: 'workspace-one', webContentsId: null }
const roots: string[] = []

afterEach(() => {
  mock.restore()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createHarness(root: string) {
  const handlers = new Map<string, HandlerFn>()
  const pushes: Array<{ channel: string; target: unknown; args: unknown[] }> = []
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push(channel, target, ...args) { pushes.push({ channel, target, args }) },
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue({
    id: 'workspace-one', name: 'Workspace One', slug: 'workspace-one', rootPath: root, createdAt: 1,
  } as never)
  registerAutomationsHandlers(server, {
    platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } },
  } as unknown as HandlerDeps)
  return { handlers, pushes }
}

function seedAutomations() {
  const root = mkdtempSync(join(tmpdir(), 'opcagent-automations-changed-'))
  roots.push(root)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'automations.json'), JSON.stringify({
    automations: {
      Stop: [{ id: 'automation-1', name: 'Original', actions: [{ type: 'webhook', url: 'http://127.0.0.1' }] }],
    },
  }))
  return root
}

describe('automation mutation broadcasts', () => {
  test.each([
    [RPC_CHANNELS.automations.SET_ENABLED, ['workspace-one', 'Stop', 0, false]],
    [RPC_CHANNELS.automations.DUPLICATE, ['workspace-one', 'Stop', 0]],
    [RPC_CHANNELS.automations.DELETE, ['workspace-one', 'Stop', 0]],
    [RPC_CHANNELS.automations.REPLAY, ['workspace-one', 'automation-1', 'Stop']],
  ] as const)('%s broadcasts a workspace refresh after success', async (channel, args) => {
    const { handlers, pushes } = createHarness(seedAutomations())
    await handlers.get(channel)!(ctx, ...args)

    expect(pushes).toEqual([{
      channel: RPC_CHANNELS.automations.CHANGED,
      target: { to: 'workspace', workspaceId: 'workspace-one' },
      args: ['workspace-one'],
    }])
  })
})

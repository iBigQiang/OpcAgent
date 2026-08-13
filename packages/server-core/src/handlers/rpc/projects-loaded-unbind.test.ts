import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@opcagent/shared/config'
import { createProject } from '@opcagent/shared/projects'
import { RPC_CHANNELS } from '@opcagent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@opcagent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerProjectsHandlers } from './projects'

const roots: string[] = []
const ctx: RequestContext = { clientId: 'client-one', workspaceId: 'workspace-one', webContentsId: null }

afterEach(() => {
  mock.restore()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('project deletion also unbinds matching loaded session metadata', async () => {
  const root = mkdtempSync(join(tmpdir(), 'opcagent-project-handler-'))
  roots.push(root)
  const project = createProject(root, { name: 'Project One' })
  const handlers = new Map<string, HandlerFn>()
  const unbindLoaded = mock(async () => 1)
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue({
    id: 'workspace-one', name: 'Workspace One', slug: 'workspace-one', rootPath: root, createdAt: 1,
  } as never)
  registerProjectsHandlers(server, {
    sessionManager: { unbindProjectFromLoadedSessions: unbindLoaded },
    platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } },
  } as unknown as HandlerDeps)

  await handlers.get(RPC_CHANNELS.projects.DELETE)!(ctx, 'workspace-one', project.slug)

  expect(unbindLoaded).toHaveBeenCalledWith('workspace-one', project.id)
})

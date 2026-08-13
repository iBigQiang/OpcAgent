import { RPC_CHANNELS } from '@opcagent/shared/protocol'
import { getWorkspaceByNameOrId } from '@opcagent/shared/config'
import { pushTyped, type RpcServer } from '@opcagent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.labels.LIST,
  RPC_CHANNELS.labels.CREATE,
  RPC_CHANNELS.labels.UPDATE,
  RPC_CHANNELS.labels.DELETE,
  RPC_CHANNELS.labels.MOVE,
  RPC_CHANNELS.labels.REORDER,
] as const

export function registerLabelsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  function requireWorkspaceContext(contextWorkspaceId: string | null, requestedWorkspaceId: string): void {
    if (!contextWorkspaceId || contextWorkspaceId !== requestedWorkspaceId) {
      throw new Error('Workspace context mismatch')
    }
  }

  // List all labels for a workspace
  server.handle(RPC_CHANNELS.labels.LIST, async (ctx, requestedWorkspaceId: string) => {
    requireWorkspaceContext(ctx.workspaceId, requestedWorkspaceId)
    const workspace = getWorkspaceByNameOrId(requestedWorkspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listLabels } = await import('@opcagent/shared/labels/storage')
    return listLabels(workspace.rootPath)
  })

  // Create a new label in a workspace
  server.handle(RPC_CHANNELS.labels.CREATE, async (ctx, requestedWorkspaceId: string, input: import('@opcagent/shared/labels').CreateLabelInput) => {
    requireWorkspaceContext(ctx.workspaceId, requestedWorkspaceId)
    const workspace = getWorkspaceByNameOrId(requestedWorkspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { createLabel } = await import('@opcagent/shared/labels/crud')
    const label = createLabel(workspace.rootPath, input)
    pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId: requestedWorkspaceId }, requestedWorkspaceId)
    return label
  })

  server.handle(RPC_CHANNELS.labels.UPDATE, async (ctx, requestedWorkspaceId: string, labelId: string, updates: import('@opcagent/shared/labels').UpdateLabelInput) => {
    requireWorkspaceContext(ctx.workspaceId, requestedWorkspaceId)
    const workspace = getWorkspaceByNameOrId(requestedWorkspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { updateLabel } = await import('@opcagent/shared/labels/crud')
    const label = updateLabel(workspace.rootPath, labelId, updates)
    pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId: requestedWorkspaceId }, requestedWorkspaceId)
    return label
  })

  // Delete a label (and descendants) from a workspace
  server.handle(RPC_CHANNELS.labels.DELETE, async (ctx, requestedWorkspaceId: string, labelId: string) => {
    requireWorkspaceContext(ctx.workspaceId, requestedWorkspaceId)
    const workspace = getWorkspaceByNameOrId(requestedWorkspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteLabel } = await import('@opcagent/shared/labels/crud')
    const result = await deleteLabel(workspace.rootPath, labelId)
    pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId: requestedWorkspaceId }, requestedWorkspaceId)
    return result
  })

  server.handle(RPC_CHANNELS.labels.MOVE, async (ctx, requestedWorkspaceId: string, labelId: string, parentId: string | null) => {
    requireWorkspaceContext(ctx.workspaceId, requestedWorkspaceId)
    const workspace = getWorkspaceByNameOrId(requestedWorkspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { moveLabel } = await import('@opcagent/shared/labels/crud')
    moveLabel(workspace.rootPath, labelId, parentId)
    pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId: requestedWorkspaceId }, requestedWorkspaceId)
  })

  server.handle(RPC_CHANNELS.labels.REORDER, async (ctx, requestedWorkspaceId: string, parentId: string | null, orderedIds: string[]) => {
    requireWorkspaceContext(ctx.workspaceId, requestedWorkspaceId)
    const workspace = getWorkspaceByNameOrId(requestedWorkspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { reorderLabels } = await import('@opcagent/shared/labels/crud')
    reorderLabels(workspace.rootPath, parentId, orderedIds)
    pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId: requestedWorkspaceId }, requestedWorkspaceId)
  })
}

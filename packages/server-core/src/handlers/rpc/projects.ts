import { RPC_CHANNELS } from '@mkagent/shared/protocol'
import { getWorkspaceByNameOrId } from '@mkagent/shared/config'
import { isValidProjectId, isValidProjectSlug } from '@mkagent/shared/projects'
import { pushTyped, type RpcServer } from '@mkagent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.projects.GET,
  RPC_CHANNELS.projects.GET_ONE,
  RPC_CHANNELS.projects.CREATE,
  RPC_CHANNELS.projects.UPDATE,
  RPC_CHANNELS.projects.DELETE,
  RPC_CHANNELS.projects.LIST_ASSETS,
  RPC_CHANNELS.projects.UPLOAD_ASSET,
  RPC_CHANNELS.projects.DELETE_ASSET,
] as const

export function registerProjectsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  function requireWorkspaceContext(contextWorkspaceId: string | null, requestedWorkspaceId: string): void {
    if (!contextWorkspaceId || contextWorkspaceId !== requestedWorkspaceId) {
      throw new Error('Workspace context mismatch')
    }
  }

  function requireProjectSlug(projectSlug: string): void {
    if (!isValidProjectSlug(projectSlug)) throw new Error('Invalid project slug')
  }

  async function broadcastChanged(workspaceId: string, workspaceRootPath: string): Promise<void> {
    const { loadWorkspaceProjects } = await import('@mkagent/shared/projects')
    const projects = loadWorkspaceProjects(workspaceRootPath)
    pushTyped(server, RPC_CHANNELS.projects.CHANGED, { to: 'workspace', workspaceId }, workspaceId, projects)
  }

  // List all projects for a workspace
  server.handle(RPC_CHANNELS.projects.GET, async (ctx, workspaceId: string) => {
    requireWorkspaceContext(ctx.workspaceId, workspaceId)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`PROJECTS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    const { loadWorkspaceProjects } = await import('@mkagent/shared/projects')
    return loadWorkspaceProjects(workspace.rootPath)
  })

  // Get one project (by id or slug)
  server.handle(RPC_CHANNELS.projects.GET_ONE, async (ctx, workspaceId: string, projectIdOrSlug: string) => {
    requireWorkspaceContext(ctx.workspaceId, workspaceId)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null
    const { loadProject, loadProjectById } = await import('@mkagent/shared/projects')
    if (isValidProjectSlug(projectIdOrSlug)) return loadProject(workspace.rootPath, projectIdOrSlug)
    if (isValidProjectId(projectIdOrSlug)) return loadProjectById(workspace.rootPath, projectIdOrSlug)
    throw new Error('Invalid project identifier')
  })

  // Create a new project
  server.handle(RPC_CHANNELS.projects.CREATE, async (ctx, workspaceId: string, input: import('@mkagent/shared/projects').CreateProjectInput) => {
    requireWorkspaceContext(ctx.workspaceId, workspaceId)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { createProject } = await import('@mkagent/shared/projects')
    const project = createProject(workspace.rootPath, {
      name: input.name?.trim() || 'New Project',
      description: input.description,
      workingDirectory: input.workingDirectory,
      details: input.details,
      colorTheme: input.colorTheme,
    })
    await broadcastChanged(workspaceId, workspace.rootPath)
    log.info(`Created project: ${project.slug}`)
    return project
  })

  // Update project (partial patch). Slug stays stable.
  server.handle(RPC_CHANNELS.projects.UPDATE, async (
    ctx,
    workspaceId: string,
    projectSlug: string,
    patch: Partial<Omit<import('@mkagent/shared/projects').ProjectConfig, 'id' | 'slug' | 'createdAt'>>,
  ) => {
    requireWorkspaceContext(ctx.workspaceId, workspaceId)
    requireProjectSlug(projectSlug)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { updateProject } = await import('@mkagent/shared/projects')
    const updated = updateProject(workspace.rootPath, projectSlug, patch)
    await broadcastChanged(workspaceId, workspace.rootPath)
    return updated
  })

  // Delete a project; unbinds projectId from any sessions that referenced it.
  server.handle(RPC_CHANNELS.projects.DELETE, async (ctx, workspaceId: string, projectSlug: string) => {
    requireWorkspaceContext(ctx.workspaceId, workspaceId)
    requireProjectSlug(projectSlug)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const { loadProject, deleteProject } = await import('@mkagent/shared/projects')
    const project = loadProject(workspace.rootPath, projectSlug)
    if (!project) {
      log.warn(`PROJECTS_DELETE: project ${projectSlug} not found`)
      return
    }

    const { unbindProjectFromSessions } = await import('@mkagent/shared/sessions')
    const touched = await unbindProjectFromSessions(workspace.rootPath, project.config.id)
    deleteProject(workspace.rootPath, projectSlug)
    await broadcastChanged(workspaceId, workspace.rootPath)
    log.info(`Deleted project ${projectSlug} (unbound ${touched} sessions)`)
  })

  // List assets in a project
  server.handle(RPC_CHANNELS.projects.LIST_ASSETS, async (ctx, workspaceId: string, projectSlug: string) => {
    requireWorkspaceContext(ctx.workspaceId, workspaceId)
    requireProjectSlug(projectSlug)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return []
    const { listProjectAssets } = await import('@mkagent/shared/projects')
    return listProjectAssets(workspace.rootPath, projectSlug)
  })

  // Upload an asset (base64 / text / sourcePath)
  server.handle(RPC_CHANNELS.projects.UPLOAD_ASSET, async (
    ctx,
    workspaceId: string,
    projectSlug: string,
    input: import('@mkagent/shared/projects').UploadProjectAssetInput,
  ) => {
    requireWorkspaceContext(ctx.workspaceId, workspaceId)
    requireProjectSlug(projectSlug)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { uploadProjectAsset } = await import('@mkagent/shared/projects')
    const asset = uploadProjectAsset(workspace.rootPath, projectSlug, input)
    await broadcastChanged(workspaceId, workspace.rootPath)
    log.info(`Uploaded asset ${asset.filename} to project ${projectSlug}`)
    return asset
  })

  // Delete an asset by filename
  server.handle(RPC_CHANNELS.projects.DELETE_ASSET, async (
    ctx,
    workspaceId: string,
    projectSlug: string,
    filename: string,
  ) => {
    requireWorkspaceContext(ctx.workspaceId, workspaceId)
    requireProjectSlug(projectSlug)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { deleteProjectAsset } = await import('@mkagent/shared/projects')
    deleteProjectAsset(workspace.rootPath, projectSlug, filename)
    await broadcastChanged(workspaceId, workspace.rootPath)
  })
}

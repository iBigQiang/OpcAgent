import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@mkagent/shared/protocol'
import { SessionManager, createManagedSession } from './SessionManager.ts'

describe('loaded project session unbinding', () => {
  let root: string
  let manager: SessionManager

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mkagent-project-unbind-'))
    manager = new SessionManager()
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function addSession(id: string, workspaceId: string, projectId: string) {
    const workspace = { id: workspaceId, name: workspaceId, slug: workspaceId, rootPath: root, createdAt: 1 }
    const managed = createManagedSession({ id, projectId }, workspace as never, { messagesLoaded: true })
    ;(manager as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  it('unbinds only matching loaded sessions, persists them, and emits project_id_changed', async () => {
    const matched = addSession('matched', 'workspace-one', 'project-one')
    const otherProject = addSession('other-project', 'workspace-one', 'project-two')
    const otherWorkspace = addSession('other-workspace', 'workspace-two', 'project-one')
    const events: Array<{ channel: string; target: unknown; event: unknown }> = []
    manager.setEventSink((channel, target, event) => events.push({ channel, target, event }))

    expect(await manager.unbindProjectFromLoadedSessions('workspace-one', 'project-one')).toBe(1)
    expect(matched.projectId).toBeUndefined()
    expect(otherProject.projectId).toBe('project-two')
    expect(otherWorkspace.projectId).toBe('project-one')
    expect(events).toEqual([{
      channel: RPC_CHANNELS.sessions.EVENT,
      target: { to: 'workspace', workspaceId: 'workspace-one' },
      event: { type: 'project_id_changed', sessionId: 'matched', projectId: null },
    }])
  })
})

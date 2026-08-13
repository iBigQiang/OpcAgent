import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createProject,
  deleteProject,
  getProjectAssetsPath,
  getProjectPath,
  isValidProjectId,
  isValidProjectSlug,
  loadProjectById,
  loadProjectPromptContext,
  loadProjectConfig,
  listProjectAssets,
  sanitizeAssetFilename,
  uploadProjectAsset,
} from '../storage'
import { createSession, loadSession, setSessionProjectId, unbindProjectFromSessions } from '../../sessions/storage'

const roots: string[] = []
function workspace(): string { const root = mkdtempSync(join(tmpdir(), 'mkagent-projects-')); roots.push(root); return root }

afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }) })

describe('project storage safety', () => {
  test('rejects path traversal by storing a bare safe asset name inside its project', () => {
    const root = workspace(); const project = createProject(root, { name: 'Safe' })
    const asset = uploadProjectAsset(root, project.slug, { filename: '..\\..\\outside.txt', text: 'inside' })
    expect(asset.filename).toBe('outside.txt')
    expect(asset.absolutePath.startsWith(getProjectAssetsPath(root, project.slug))).toBe(true)
    expect(existsSync(join(getProjectPath(root, project.slug), 'outside.txt'))).toBe(false)
  })
  test('returns null for a corrupt project config instead of fabricating a project', () => {
    const root = workspace(); const project = createProject(root, { name: 'Broken' })
    writeFileSync(join(getProjectPath(root, project.slug), 'config.json'), '{broken')
    expect(loadProjectConfig(root, project.slug)).toBeNull()
  })
  test('fails closed for a parseable config with mismatched or unsafe identity fields', () => {
    const root = workspace(); const project = createProject(root, { name: 'Broken Shape' })
    writeFileSync(join(getProjectPath(root, project.slug), 'config.json'), JSON.stringify({ ...project, id: 'proj_notvalid', slug: '../outside' }))
    expect(loadProjectConfig(root, project.slug)).toBeNull()
  })
  test('strips controls and separators from uploaded filenames', () => {
    expect(sanitizeAssetFilename('../re\x00port\n.pdf')).toBe('report.pdf')
  })
  test('accepts generated identifiers and rejects project path traversal identifiers', () => {
    const root = workspace(); const project = createProject(root, { name: 'Fresh Project' })
    expect(isValidProjectSlug(project.slug)).toBe(true)
    expect(isValidProjectId(project.id)).toBe(true)
    for (const value of ['..', '../outside', '..\\outside', '/tmp/project', 'C:\\project', 'project/name', 'project\\name', '']) {
      expect(isValidProjectSlug(value)).toBe(false)
      expect(() => getProjectPath(root, value)).toThrow('Invalid project slug')
      expect(() => deleteProject(root, value)).toThrow('Invalid project slug')
    }
    for (const value of ['..', '../outside', 'proj_ABCDEF12', 'project']) {
      expect(isValidProjectId(value)).toBe(false)
      expect(() => loadProjectById(root, value)).toThrow('Invalid project id')
    }
  })
  test('clears a project binding and unbinds every session before deletion', async () => {
    const root = workspace(); const project = createProject(root, { name: 'Binding' })
    const first = await createSession(root, { name: 'First' })
    const second = await createSession(root, { name: 'Second' })
    await setSessionProjectId(root, first.id, project.id)
    await setSessionProjectId(root, second.id, project.id)
    await setSessionProjectId(root, first.id, null)
    expect(loadSession(root, first.id)?.projectId).toBeUndefined()
    expect(loadSession(root, second.id)?.projectId).toBe(project.id)
    expect(await unbindProjectFromSessions(root, project.id)).toBe(1)
    expect(loadSession(root, second.id)?.projectId).toBeUndefined()
  })

  test('loads only MEMORY.md text and asset file names for an explicitly bound project', () => {
    const root = workspace(); const project = createProject(root, { name: 'Context' })
    writeFileSync(join(getProjectPath(root, project.slug), 'MEMORY.md'), 'Authorized memory')
    uploadProjectAsset(root, project.slug, { filename: 'reference.txt', text: 'SECRET_ASSET_BODY' })

    const context = loadProjectPromptContext(root, project.id)
    expect(context).toEqual({ memoryContent: 'Authorized memory', assetFilenames: ['reference.txt'] })
    expect(JSON.stringify(context)).not.toContain('SECRET_ASSET_BODY')
    expect(JSON.stringify(context)).not.toContain(getProjectAssetsPath(root, project.slug))
    expect(loadProjectPromptContext(root, 'proj_ffffffff')).toBeNull()
  })
  test('asset listing is a pure read when assets were never created', () => {
    const root = workspace(); const project = createProject(root, { name: 'No Assets' })
    rmSync(getProjectAssetsPath(root, project.slug), { recursive: true, force: true })
    expect(existsSync(getProjectAssetsPath(root, project.slug))).toBe(false)
    expect(listProjectAssets(root, project.slug)).toEqual([])
    expect(existsSync(getProjectAssetsPath(root, project.slug))).toBe(false)
  })
})

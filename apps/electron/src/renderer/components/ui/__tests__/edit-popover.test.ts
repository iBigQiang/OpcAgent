/** Tests for EditPopover prompt context that do not require a browser renderer. */

import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The prompt helpers share the component module with the Vite-only chat tree.
// Replace that tree so the helpers can be tested directly in Bun.
mock.module('../app-shell/ChatDisplay', () => ({
  ChatDisplay: () => null,
}))
mock.module('../app-shell/ChatDisplay.tsx', () => ({
  ChatDisplay: () => null,
}))
mock.module('@/components/app-shell/ChatDisplay', () => ({
  ChatDisplay: () => null,
}))
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let getEditConfig: typeof import('../EditPopover').getEditConfig
let buildEditPrompt: typeof import('../EditPopover').buildEditPrompt

beforeAll(async () => {
  const module = await import('../EditPopover')
  getEditConfig = module.getEditConfig
  buildEditPrompt = module.buildEditPrompt
})

describe('automation config edit context', () => {
  it('keeps the automation navigator add button wired to the shared editor', () => {
    const appShell = readFileSync(resolve(import.meta.dir, '../../app-shell/AppShell.tsx'), 'utf8')
    const automationActionStart = appShell.indexOf('{isAutomationsNavigation(navState) && activeWorkspace && (')
    const projectActionStart = appShell.indexOf('{isProjectsNavigation(navState) && activeWorkspace && (', automationActionStart)
    const automationAction = appShell.slice(automationActionStart, projectActionStart)

    expect(automationActionStart).toBeGreaterThan(-1)
    expect(projectActionStart).toBeGreaterThan(automationActionStart)
    expect(automationAction).toContain("tooltip={t('automations.addAutomation')}")
    expect(automationAction).toContain("getEditConfig('automation-config', activeWorkspace.rootPath)")
  })

  it('reuses the shared chat input Skill mention plumbing', () => {
    const editPopover = readFileSync(resolve(import.meta.dir, '../EditPopover.tsx'), 'utf8')

    expect(editPopover).toContain('skillSlugs?: string[]')
    expect(editPopover).toContain('onSendMessage(sessionId, prompt, attachments, skillSlugs, badges)')
    expect(editPopover).toContain('skills={skills}')
    expect(editPopover).toContain('workspaceId={activeWorkspaceId || workspace?.id}')
  })

  it('guides a first-time configuration to create a version 2 root and read the OPC docs', () => {
    const config = getEditConfig('automation-config', 'C:/workspace')
    const { prompt, badges } = buildEditPrompt(config.context, 'Create a daily summary')

    expect(config.inlineExecution).toBe(true)
    expect(config.context.filePath).toBe('C:/workspace/automations.json')
    expect(prompt).toContain('optional workspace automations.json')
    expect(prompt).toContain('without reading it first')
    expect(prompt).toContain('{ "version": 2, "automations": {} }')
    expect(prompt).toContain('~/.opcagent/docs/automations.md')
    expect(prompt).toContain('do not add credentials, tokens, or secrets')
    expect(badges[0]).toMatchObject({ type: 'context', rawText: expect.stringContaining('<edit_request>') })
  })
})

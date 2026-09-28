import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SESSION_MANAGER_URL = pathToFileURL(join(import.meta.dir, 'SessionManager.ts')).href

describe('SessionManager branching', () => {
  it('copies transcript and Pi resume metadata through the selected message', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'opcagent-session-branch-'))
    const workspaceRoot = join(configDir, 'workspaces', 'default')
    const sessionIds: string[] = []
    try {
      const script = `
        import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
        import { join } from 'node:path';
        import { SessionManager, savePiTurnAnchor, loadPiTurnAnchors } from ${JSON.stringify(SESSION_MANAGER_URL)};
        import { createSession, getSessionPath, loadSession, saveSession } from '@opcagent/shared/sessions';

        const configDir = process.env.CONFIG_DIR;
        const workspaceRoot = join(configDir, 'workspaces', 'default');
        mkdirSync(workspaceRoot, { recursive: true });
        writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({
          id: 'workspace-config', name: 'Default', slug: 'default', defaults: {},
          createdAt: Date.now(), updatedAt: Date.now(),
        }));
        writeFileSync(join(configDir, 'config.json'), JSON.stringify({
          workspaces: [{ id: 'workspace-default', name: 'Default', slug: 'default', rootPath: workspaceRoot, createdAt: Date.now() }],
          activeWorkspaceId: 'workspace-default', activeSessionId: null, llmConnections: [],
        }));

        const sourceConfig = await createSession(workspaceRoot, { name: 'Parent' });
        const source = loadSession(workspaceRoot, sourceConfig.id);
        source.sdkSessionId = 'pi-session-parent';
        source.sdkCwd = join(configDir, 'pi-parent');
        source.messages = [
          { id: 'user-1', type: 'user', content: 'first', timestamp: 1 },
          { id: 'assistant-1', type: 'assistant', content: 'answer', timestamp: 2 },
          { id: 'user-2', type: 'user', content: 'later', timestamp: 3 },
          { id: 'assistant-2', type: 'assistant', content: 'later answer', timestamp: 4 },
        ];
        await saveSession(source);
        await savePiTurnAnchor(getSessionPath(workspaceRoot, source.id), 'assistant-2', 'pi-entry-2');

        const manager = new SessionManager();
        await manager.initialize();
        const preparedTurnIds = [];
        manager.getOrCreateAgent = async (managed) => {
          managed.agent = {
            ensureBranchReady: async () => { preparedTurnIds.push(managed.branchFromSdkTurnId); },
            destroy: () => {},
          };
          return managed.agent;
        };
        const beforeSessionIds = readdirSync(join(workspaceRoot, 'sessions')).sort();
        let missingAnchorError;
        try {
          await manager.createSession('workspace-default', {
            branchFromSessionId: source.id,
            branchFromMessageId: 'assistant-1',
          });
        } catch (error) {
          missingAnchorError = error.message;
        }
        const rejected = {
          error: missingAnchorError,
          beforeSessionIds,
          storedSessionIds: readdirSync(join(workspaceRoot, 'sessions')).sort(),
          runtimeSessionIds: manager.getSessions().map(session => session.id).sort(),
          preparedTurnIds: [...preparedTurnIds],
        };
        await savePiTurnAnchor(getSessionPath(workspaceRoot, source.id), 'assistant-1', 'pi-entry-1');
        const branch = await manager.createSession('workspace-default', {
          branchFromSessionId: source.id,
          branchFromMessageId: 'assistant-1',
        });
        const storedBranch = loadSession(workspaceRoot, branch.id);
        const anchors = await loadPiTurnAnchors(getSessionPath(workspaceRoot, branch.id));
        manager.cleanup();
        console.log(JSON.stringify({ branch, storedBranch, anchors, rejected, preparedTurnIds, sourceId: source.id }));
      `
      const run = Bun.spawnSync([process.execPath, '--eval', script], {
        cwd: join(import.meta.dir, '..', '..', '..'),
        env: { ...process.env, CONFIG_DIR: configDir },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      expect(run.exitCode, run.stderr.toString()).toBe(0)
      const { branch, storedBranch, anchors, rejected, preparedTurnIds, sourceId } = JSON.parse(run.stdout.toString())
      sessionIds.push(sourceId, branch.id)
      // 选择的助手消息缺少锚点时，不能借用后续回复的锚点或留下半成品分支。
      expect(rejected.error).toBe('所选消息缺少可恢复的 Pi 分支切点，请在新的助手回复处创建分支')
      expect(rejected.beforeSessionIds).toEqual([sourceId])
      expect(rejected.storedSessionIds).toEqual(rejected.beforeSessionIds)
      expect(rejected.runtimeSessionIds).toEqual(rejected.beforeSessionIds)
      expect(rejected.preparedTurnIds).toEqual([])
      expect(branch.messages.map((message: { id: string }) => message.id)).toEqual(['user-1', 'assistant-1'])
      expect(branch.messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant'])
      expect(storedBranch.messages.map((message: { type: string }) => message.type)).toEqual(['user', 'assistant'])
      expect(storedBranch.branchFromMessageId).toBe('assistant-1')
      expect(storedBranch.branchFromSdkSessionId).toBe('pi-session-parent')
      expect(storedBranch.branchFromSdkCwd).toBe(join(configDir, 'pi-parent'))
      expect(storedBranch.branchFromSdkTurnId).toBe('pi-entry-1')
      expect(preparedTurnIds).toEqual(['pi-entry-1'])
      expect(anchors.anchors).toEqual({ 'assistant-1': 'pi-entry-1' })
    } finally {
      // 只清理本用例明确创建的文件和空目录，未知产物保留以便定位失败。
      const removeFile = (path: string) => { if (existsSync(path)) unlinkSync(path) }
      const removeEmpty = (path: string) => { if (existsSync(path) && readdirSync(path).length === 0) rmdirSync(path) }
      for (const sessionId of sessionIds) {
        const sessionPath = join(workspaceRoot, 'sessions', sessionId)
        removeFile(join(sessionPath, 'session.jsonl'))
        removeFile(join(sessionPath, 'meta', 'pi-turn-anchors.json'))
        for (const directory of ['meta', 'attachments', 'plans', 'long_responses', 'data', 'downloads']) removeEmpty(join(sessionPath, directory))
        removeEmpty(sessionPath)
      }
      removeFile(join(workspaceRoot, 'config.json'))
      removeFile(join(configDir, 'config.json'))
      removeFile(join(configDir, 'config-defaults.json'))
      removeEmpty(join(workspaceRoot, 'sessions'))
      removeEmpty(workspaceRoot)
      removeEmpty(join(configDir, 'workspaces'))
      removeEmpty(join(configDir, 'themes'))
      removeEmpty(join(configDir, 'permissions'))
      removeEmpty(join(configDir, 'logs'))
      removeEmpty(configDir)
    }
  })
})

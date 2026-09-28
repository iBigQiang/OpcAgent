import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';

function mostRecentSessionFile(sessionDir: string): string | undefined {
  if (!existsSync(sessionDir)) return undefined;
  return readdirSync(sessionDir)
    .filter(name => name.endsWith('.jsonl'))
    .map(name => ({ path: join(sessionDir, name), mtime: statSync(join(sessionDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.path;
}

function readSessionEntries(file: string): Array<Record<string, unknown>> {
  try {
    const entries = readFileSync(file, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    if (!entries.length || entries.some(entry => !entry || typeof entry !== 'object' || typeof entry.type !== 'string')
      || entries[0].type !== 'session' || typeof entries[0].id !== 'string' || !entries[0].id
      || entries.slice(1).some(entry => entry.type === 'session'
        || (entry.type === 'message' && (!entry.message || typeof entry.message.role !== 'string')))) {
      throw new Error('会话格式无效');
    }
    return entries;
  } catch {
    // SDK 会忽略无法解析的行；切换时必须拒绝，避免成功恢复成部分或空历史。
    throw new Error(`Pi 历史恢复失败：文件损坏或格式无效：${file}`);
  }
}

/** 已有分支自己的历史优先；只有首次创建才从父会话切点派生。 */
export function restorePiSession(options: {
  cwd: string;
  sessionPath: string;
  branchFromSessionPath?: string;
  branchFromSdkTurnId?: string;
  requireExistingSession?: boolean;
}): SessionManager {
  const sessionDir = join(options.sessionPath, '.pi-sessions');
  const existingFile = mostRecentSessionFile(sessionDir);
  if (existingFile) {
    const entries = readSessionEntries(existingFile);
    // continueRecent 会跳过坏文件头或 cwd 不同的文件；明确打开已识别的历史。
    const manager = SessionManager.open(existingFile, sessionDir, options.cwd);
    if (manager.getSessionId() !== entries[0]!.id) {
      throw new Error(`Pi 历史恢复失败：会话标识发生变化：${existingFile}`);
    }
    if (options.requireExistingSession && manager.buildSessionContext().messages.length === 0) {
      throw new Error(`Pi 历史恢复失败：文件中没有可恢复的会话上下文：${existingFile}`);
    }
    return manager;
  }
  if (options.requireExistingSession) {
    throw new Error(`Pi 历史恢复失败：当前会话的 SDK 历史文件缺失：${sessionDir}`);
  }
  mkdirSync(sessionDir, { recursive: true });
  if (!options.branchFromSessionPath) {
    return SessionManager.continueRecent(options.cwd, sessionDir);
  }

  const parentDir = join(options.branchFromSessionPath, '.pi-sessions');
  const parentFile = mostRecentSessionFile(parentDir);
  if (!parentFile) throw new Error(`Pi 分支恢复失败：父会话没有历史文件：${parentDir}`);
  const parentEntries = readSessionEntries(parentFile);
  const anchorId = options.branchFromSdkTurnId;
  // 先验证再创建分支文件，避免失败留下可被误恢复的完整父历史。
  if (anchorId && !parentEntries.some(entry => entry.id === anchorId)) {
    throw new Error(`Pi 分支恢复失败：找不到分支切点：${anchorId}`);
  }
  const manager = SessionManager.forkFrom(parentFile, options.cwd, sessionDir);
  if (anchorId) {
    manager.branch(anchorId);
    // branch() 只修改内存叶子；预热后尚未发消息就重启也必须保留切点。
    manager.appendCustomEntry('opc_branch_anchor', { anchorId });
  }
  return manager;
}

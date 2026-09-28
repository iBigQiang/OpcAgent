import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { restorePiSession } from './session-resume.ts';

function assistant(text: string): AssistantMessage {
  return { role: 'assistant', content: [{ type: 'text', text }], api: 'openai-responses', provider: 'openai',
    model: 'same-model', stopReason: 'stop', timestamp: Date.now(),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}

describe('Pi 分支历史恢复', () => {
  it('首次按锚点分支，已有分支在切换与重启后恢复自己的新增对话', () => {
    const root = mkdtempSync(join(tmpdir(), 'opc-pi-branch-'));
    const parentPath = join(root, 'parent');
    const childPath = join(root, 'child');
    const parent = restorePiSession({ cwd: root, sessionPath: parentPath });
    let childFile: string | undefined;
    try {
      parent.appendMessage({ role: 'user', content: '父会话任务', timestamp: Date.now() });
      const anchor = parent.appendMessage(assistant('父会话切点'));
      parent.appendMessage(assistant('切点之后不应带入'));
      const options = { cwd: root, sessionPath: childPath, branchFromSessionPath: parentPath, branchFromSdkTurnId: anchor };
      const child = restorePiSession(options);
      childFile = child.getSessionFile();
      expect(JSON.stringify(child.buildSessionContext())).not.toContain('切点之后不应带入');
      expect(JSON.stringify(restorePiSession(options).buildSessionContext())).not.toContain('切点之后不应带入');
      child.appendMessage({ role: 'user', content: '分支新增任务', timestamp: Date.now() });
      child.appendMessage(assistant('分支新增回答'));
      const switched = restorePiSession(options);
      expect(switched.getSessionId()).toBe(child.getSessionId());
      expect(JSON.stringify(switched.buildSessionContext())).toContain('分支新增回答');
      const restarted = restorePiSession({ ...options, branchFromSessionPath: join(root, '已删除父会话') });
      expect(restarted.getSessionId()).toBe(child.getSessionId());
      expect(JSON.stringify(restarted.buildSessionContext())).toContain('分支新增任务');
      expect(readdirSync(join(childPath, '.pi-sessions'))).toHaveLength(1);
    } finally {
      if (childFile) unlinkSync(childFile);
      unlinkSync(parent.getSessionFile()!);
      rmdirSync(join(childPath, '.pi-sessions'));
      rmdirSync(childPath);
      rmdirSync(join(parentPath, '.pi-sessions'));
      rmdirSync(parentPath);
      rmdirSync(root);
    }
  });

  it('首次分支锚点无效时拒绝，并且不留下可被误恢复的文件', () => {
    const root = mkdtempSync(join(tmpdir(), 'opc-pi-invalid-branch-'));
    const parentPath = join(root, 'parent');
    const childPath = join(root, 'child');
    const parent = restorePiSession({ cwd: root, sessionPath: parentPath });
    try {
      parent.appendMessage(assistant('父会话'));
      expect(() => restorePiSession({ cwd: root, sessionPath: childPath,
        branchFromSessionPath: parentPath, branchFromSdkTurnId: 'missing-anchor' })).toThrow('找不到分支切点');
      expect(readdirSync(join(childPath, '.pi-sessions'))).toHaveLength(0);
    } finally {
      if (existsSync(parent.getSessionFile()!)) unlinkSync(parent.getSessionFile()!);
      rmdirSync(join(childPath, '.pi-sessions'));
      rmdirSync(childPath);
      rmdirSync(join(parentPath, '.pi-sessions'));
      rmdirSync(parentPath);
      rmdirSync(root);
    }
  });

  it('恢复保留 SDK 压缩摘要和压缩后上下文，不退回界面纯文本历史', () => {
    const root = mkdtempSync(join(tmpdir(), 'opc-pi-compacted-'));
    const session = restorePiSession({ cwd: root, sessionPath: root });
    try {
      session.appendMessage({ role: 'user', content: '早期任务', timestamp: Date.now() });
      session.appendMessage(assistant('早期回答'));
      const kept = session.appendMessage({ role: 'user', content: '继续任务', timestamp: Date.now() });
      session.appendMessage(assistant('压缩后保留的回答'));
      session.appendCompaction('之前已经完成的任务与决定', kept, 1000);
      const restored = restorePiSession({ cwd: root, sessionPath: root });
      const messages = restored.buildSessionContext().messages;
      expect(messages.some(message => message.role === 'compactionSummary')).toBe(true);
      expect(JSON.stringify(messages)).toContain('之前已经完成的任务与决定');
      expect(JSON.stringify(messages)).toContain('压缩后保留的回答');
      expect(JSON.stringify(messages)).not.toContain('早期回答');
    } finally {
      unlinkSync(session.getSessionFile()!);
      rmdirSync(join(root, '.pi-sessions'));
      rmdirSync(root);
    }
  });

  it('要求已有历史但文件缺失时拒绝，不新建也不重新 fork 父会话', () => {
    const root = mkdtempSync(join(tmpdir(), 'opc-pi-missing-'));
    try {
      expect(() => restorePiSession({ cwd: root, sessionPath: root, requireExistingSession: true,
        branchFromSessionPath: join(root, 'parent') })).toThrow('SDK 历史文件缺失');
      expect(existsSync(join(root, '.pi-sessions'))).toBe(false);
    } finally {
      rmdirSync(root);
    }
  });

  it.each(['', '不是 JSON', '{"type":"message","id":"bad-header"}',
    '{"type":"session","id":"valid-header"}\n{"type":"message",',
    '{"type":"session","id":"valid-header"}\n{"type":"message","message":null}'])
  ('损坏日志拒绝恢复，原文件保持不变：%s', contents => {
    const root = mkdtempSync(join(tmpdir(), 'opc-pi-corrupt-'));
    const directory = join(root, '.pi-sessions');
    mkdirSync(directory);
    const file = join(directory, 'invalid.jsonl');
    writeFileSync(file, contents);
    try {
      expect(() => restorePiSession({ cwd: root, sessionPath: root })).toThrow('文件损坏或格式无效');
      expect(readFileSync(file, 'utf8')).toBe(contents);
      expect(readdirSync(directory)).toHaveLength(1);
    } finally {
      unlinkSync(file);
      rmdirSync(directory);
      rmdirSync(root);
    }
  });

  it('工作目录变化不会跳过已有历史并创建空会话', () => {
    const root = mkdtempSync(join(tmpdir(), 'opc-pi-cwd-'));
    const session = restorePiSession({ cwd: root, sessionPath: root });
    try {
      session.appendMessage(assistant('原有上下文'));
      const restored = restorePiSession({ cwd: join(root, 'new-cwd'), sessionPath: root, requireExistingSession: true });
      expect(restored.getSessionId()).toBe(session.getSessionId());
      expect(JSON.stringify(restored.buildSessionContext())).toContain('原有上下文');
    } finally {
      unlinkSync(session.getSessionFile()!);
      rmdirSync(join(root, '.pi-sessions'));
      rmdirSync(root);
    }
  });

  it('已有聊天要求上下文，但日志只剩文件头时拒绝切换', () => {
    const root = mkdtempSync(join(tmpdir(), 'opc-pi-empty-history-'));
    const directory = join(root, '.pi-sessions');
    mkdirSync(directory);
    const file = join(directory, 'header-only.jsonl');
    writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: 'header-only', cwd: root }));
    try {
      expect(() => restorePiSession({ cwd: root, sessionPath: root, requireExistingSession: true }))
        .toThrow('没有可恢复的会话上下文');
    } finally {
      unlinkSync(file);
      rmdirSync(directory);
      rmdirSync(root);
    }
  });
});

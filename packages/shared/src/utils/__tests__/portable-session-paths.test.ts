import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expandPath, toPortablePath } from '../paths.ts';

describe('会话目录的便携路径往返', () => {
  test('持久化队列与 JSONL 文件头连续转换后仍恢复原工作区', () => {
    const workspace = join(homedir(), '.opcagent', 'workspaces', 'test-only');
    const once = toPortablePath(workspace);
    const twice = toPortablePath(once);
    expect(twice).toBe(once);
    expect(once).toBe('~/.opcagent/workspaces/test-only');
    expect(expandPath(twice)).toBe(workspace);
  });

  test('旧 Windows 便携路径恢复到用户目录而不是当前仓库', () => {
    const legacy = '~\\.opcagent\\workspaces\\test-only';
    const workspace = join(homedir(), '.opcagent', 'workspaces', 'test-only');
    expect(expandPath(legacy)).toBe(workspace);
    expect(toPortablePath(legacy)).toBe('~/.opcagent/workspaces/test-only');
    expect(expandPath(toPortablePath(legacy))).toBe(workspace);
  });

  test('用户根目录本身保持幂等', () => {
    expect(toPortablePath(toPortablePath(homedir()))).toBe('~');
    expect(expandPath('~')).toBe(homedir());
  });
});

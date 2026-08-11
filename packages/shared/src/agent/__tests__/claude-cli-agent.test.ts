import { describe, expect, it } from 'bun:test';
import { ClaudeCliAgent, buildClaudeCliArgs, buildClaudeCliEnv, buildClaudeCliSpawn } from '../claude-cli-agent.ts';
import type { BackendConfig } from '../backend/types.ts';

function createConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    provider: 'anthropic',
    model: 'claude-main',
    miniModel: 'claude-mini',
    workspace: {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: '/tmp/mkagent-test',
    } as any,
    session: {
      id: 'session-test',
      workspaceRootPath: '/tmp/mkagent-test',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      sdkSessionId: 'main-session',
    } as any,
    isHeadless: true,
    ...overrides,
  };
}

function createQueue(): { events: Array<{ type: string; message?: string }>; hasText: boolean; push: (event: any) => void } {
  const events: Array<{ type: string; message?: string }> = [];
  return {
    events,
    hasText: false,
    push: event => events.push(event),
  };
}

describe('ClaudeCliAgent runtime isolation', () => {
  it('uses stream-json, the selected model, and dontAsk without bypassing permissions', () => {
    expect(buildClaudeCliArgs({ model: 'claude-opus-5[1m]', systemPrompt: 'MkAgent', sessionId: 'session-1' })).toEqual([
      '--print',
      '--input-format', 'text',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'dontAsk',
      '--model', 'claude-opus-5[1m]',
      '--append-system-prompt', 'MkAgent',
      '--resume', 'session-1',
    ]);
  });

  it('uses dontAsk for a connection test without resuming another session', () => {
    expect(buildClaudeCliArgs({ model: 'claude-opus-5[1m]', systemPrompt: '' })).toEqual([
      '--print',
      '--input-format', 'text',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'dontAsk',
      '--model', 'claude-opus-5[1m]',
    ]);
  });

  it('never routes a Windows command shim through cmd.exe', () => {
    if (process.platform === 'win32') {
      expect(() => buildClaudeCliSpawn('C:\\Tools\\claude.cmd', ['--append-system-prompt', '" & whoami & "'])).toThrow(
        /native claude\.exe/,
      );
    } else {
      expect(buildClaudeCliSpawn('/usr/local/bin/claude', ['--version'])).toEqual({
        command: '/usr/local/bin/claude',
        args: ['--version'],
      });
    }
  });

  it('builds an isolated connection environment without conflicting auth routes', () => {
    const env = buildClaudeCliEnv({
      baseUrl: 'https://anyrouter.top',
      authToken: 'test-token',
      configDir: 'C:/tmp/mkagent-claude',
      envOverrides: {
        ANTHROPIC_API_KEY: 'stale',
        CLAUDE_CODE_OAUTH_TOKEN: 'stale',
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_USE_VERTEX: '1',
        ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock.example.test',
        AWS_ACCESS_KEY_ID: 'stale',
        AWS_SECRET_ACCESS_KEY: 'stale',
        AWS_SESSION_TOKEN: 'stale',
      },
    });

    expect(env.ANTHROPIC_BASE_URL).toBe('https://anyrouter.top');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('test-token');
    expect(env.CLAUDE_CONFIG_DIR).toBe('C:/tmp/mkagent-claude');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
    expect(env.ANTHROPIC_BEDROCK_BASE_URL).toBeUndefined();
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.AWS_SESSION_TOKEN).toBeUndefined();
  });

  it('does not inherit an Anthropic endpoint or token when the connection omits them', () => {
    const env = buildClaudeCliEnv({
      configDir: 'C:\\isolated',
      envOverrides: {
        ANTHROPIC_AUTH_TOKEN: 'parent-token',
        ANTHROPIC_BASE_URL: 'https://parent.example',
      },
    });

    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('keeps secondary CLI session IDs out of the persisted chat session', () => {
    const updates: string[] = [];
    const agent = new ClaudeCliAgent(createConfig({ onSdkSessionIdUpdate: id => updates.push(id) }));
    const queue = createQueue();

    (agent as any).consumeLine(JSON.stringify({ session_id: 'secondary-session' }), queue, false);
    expect(updates).toEqual([]);
    expect((agent as any).cliSessionId).toBe('main-session');

    (agent as any).consumeLine(JSON.stringify({ session_id: 'chat-session' }), queue, true);
    expect(updates).toEqual(['chat-session']);
    expect((agent as any).cliSessionId).toBe('chat-session');
    agent.destroy();
  });

  it('uses the mini model for mini completions and the request model and system prompt for queries', async () => {
    const agent = new ClaudeCliAgent(createConfig());
    const invocations: any[] = [];
    (agent as any).startCli = async (_prompt: string, invocation: unknown, queue: { close: () => void }) => {
      invocations.push(invocation);
      queue.close();
    };

    await agent.runMiniCompletion('Give this chat a title');
    await agent.queryLlm({
      prompt: 'Classify this text',
      model: 'claude-query',
      systemPrompt: 'Return only one label.',
    });

    expect(invocations[0]).toMatchObject({
      model: 'claude-mini',
      resume: false,
      persistSession: false,
    });
    expect(invocations[1]).toEqual({
      model: 'claude-query',
      systemPrompt: 'Return only one label.',
      resume: false,
      persistSession: false,
    });
    agent.destroy();
  });

  it('fails fast only for unrecoverable authentication api_retry events', () => {
    const agent = new ClaudeCliAgent(createConfig());
    const queue = createQueue();

    const authRetry = (agent as any).consumeLine(JSON.stringify({
      type: 'system',
      subtype: 'api_retry',
      error: 'authentication_failed: token=secret-value',
    }), queue, true);
    expect(authRetry).toMatchObject({
      fatal: true,
      userMessage: 'Claude CLI authentication failed. Check this connection\'s API key and endpoint.',
    });
    expect(authRetry.detail).not.toContain('secret-value');

    const transientRetry = (agent as any).consumeLine(JSON.stringify({
      type: 'system',
      subtype: 'api_retry',
      error: 'rate_limit_error',
    }), queue, true);
    expect(transientRetry).toMatchObject({ fatal: false, detail: 'rate_limit_error' });
    expect(queue.events).toEqual([]);
    agent.destroy();
  });
});

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent } from '@mkagent/core/types';
import { BaseAgent } from './base-agent.ts';
import type { BackendConfig, ChatOptions } from './backend/types.ts';
import { AbortReason } from './backend/types.ts';
import { getBackendRuntime } from './backend/internal/driver-types.ts';
import { getCredentialManager } from '../credentials/index.ts';
import type { FileAttachment } from '../utils/files.ts';
import type { LLMQueryRequest, LLMQueryResult } from './llm-tool.ts';

const CLEARED_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'ANTHROPIC_BEDROCK_BASE_URL',
] as const;

const CLAUDE_CLI_TIMEOUT_MS = 150_000;

interface ClaudeCliRuntime {
  baseUrl?: string;
  paths?: { claudeExecutable?: string };
}

export function buildClaudeCliSpawn(executable: string, args: string[]): { command: string; args: string[] } {
  if (process.platform === 'win32' && !/claude\.exe$/i.test(executable)) {
    throw new Error('Claude Code must use the native claude.exe. Claude .cmd/.bat shims are not supported; upgrade Claude Code or select bin\\claude.exe.');
  }
  return { command: executable, args };
}

interface ClaudeCliMessage {
  type?: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  error?: string | { type?: string; message?: string; error?: string };
  message?: { content?: Array<{ type?: string; text?: string }> };
}

interface ClaudeCliInvocation {
  model: string;
  systemPrompt: string;
  resume: boolean;
  persistSession: boolean;
}

export function buildClaudeCliEnv(args: {
  baseUrl?: string;
  authToken?: string;
  configDir: string;
  envOverrides?: Record<string, string>;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...args.envOverrides };
  for (const key of Object.keys(env)) {
    if (key.startsWith('ANTHROPIC_BEDROCK_')) delete env[key];
  }
  for (const key of CLEARED_ENV_KEYS) delete env[key];
  env.CLAUDE_CONFIG_DIR = args.configDir;
  if (args.baseUrl?.trim()) env.ANTHROPIC_BASE_URL = args.baseUrl.trim();
  if (args.authToken) env.ANTHROPIC_AUTH_TOKEN = args.authToken;
  return env;
}

export function buildClaudeCliArgs(args: {
  model: string;
  systemPrompt: string;
  sessionId?: string | null;
}): string[] {
  return [
    '--print',
    '--input-format', 'text',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'dontAsk',
    '--model', args.model,
    ...(args.systemPrompt ? ['--append-system-prompt', args.systemPrompt] : []),
    ...(args.sessionId ? ['--resume', args.sessionId] : []),
  ];
}

class EventQueue {
  private events: AgentEvent[] = [];
  private waiters: Array<(event: AgentEvent | null) => void> = [];
  private complete = false;
  hasText = false;

  push(event: AgentEvent): void {
    if (event.type === 'text_delta') this.hasText = true;
    const waiter = this.waiters.shift();
    if (waiter) waiter(event);
    else this.events.push(event);
  }

  close(): void {
    this.complete = true;
    for (const waiter of this.waiters.splice(0)) waiter(null);
  }

  async next(): Promise<AgentEvent | null> {
    const event = this.events.shift();
    if (event) return event;
    if (this.complete) return null;
    return new Promise(resolve => this.waiters.push(resolve));
  }
}

export class ClaudeCliAgent extends BaseAgent {
  protected backendName = 'Claude Code CLI';
  private child: ChildProcess | null = null;
  private processing = false;
  private cliSessionId: string | null;
  private cliEnv: NodeJS.ProcessEnv | null = null;

  constructor(config: BackendConfig) {
    super(config, config.model ?? '');
    this.cliSessionId = config.session?.sdkSessionId ?? null;
    this._supportsBranching = false;
    if (!config.isHeadless) this.startConfigWatcher();
  }

  async postInit() {
    const credential = this.config.connectionSlug
      ? await getCredentialManager().getLlmApiKey(this.config.connectionSlug)
      : null;
    const runtime = getBackendRuntime(this.config) as ClaudeCliRuntime;
    const configDir = join(this.config.workspace.rootPath, '.mkagent', 'claude-cli', this._sessionId);
    mkdirSync(configDir, { recursive: true });
    this.cliEnv = buildClaudeCliEnv({
      baseUrl: runtime.baseUrl,
      authToken: credential ?? undefined,
      configDir,
      envOverrides: this.config.envOverrides,
    });
    return credential
      ? { authInjected: true }
      : { authInjected: false, authWarning: 'Could not retrieve credentials', authWarningLevel: 'error' as const };
  }

  async abort(): Promise<void> {
    this.forceAbort(AbortReason.UserStop);
  }

  forceAbort(_reason: AbortReason): void {
    this.child?.kill();
    this.child = null;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  respondToPermission(_requestId: string, _allowed: boolean): void {
    // Interactive CLI uses its own default permission mode; it never bypasses permissions.
  }

  override destroy(): void {
    this.forceAbort(AbortReason.UserStop);
    super.destroy();
  }

  async queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
    const model = request.model ?? this.config.miniModel ?? this._model;
    const text = await this.runCli(request.prompt, {
      model,
      systemPrompt: request.systemPrompt ?? '',
      resume: false,
      persistSession: false,
    });
    return { text: text ?? '', model };
  }

  async runMiniCompletion(prompt: string): Promise<string | null> {
    return this.runCli(prompt, {
      model: this.config.miniModel ?? this._model,
      systemPrompt: this.buildSystemPrompt(),
      resume: false,
      persistSession: false,
    });
  }

  protected async *chatImpl(
    message: string,
    attachments?: FileAttachment[],
    _options?: ChatOptions,
  ): AsyncGenerator<AgentEvent> {
    this.processing = true;
    const queue = new EventQueue();
    let text = '';
    try {
      await this.startCli(this.buildPrompt(message, attachments), {
        model: this._model,
        systemPrompt: this.buildSystemPrompt(),
        resume: true,
        persistSession: true,
      }, queue);
      for (;;) {
        const event = await queue.next();
        if (!event) break;
        if (event.type === 'text_delta') text += event.text;
        yield event;
      }
      if (text) yield { type: 'text_complete', text };
      yield { type: 'complete' };
    } finally {
      this.processing = false;
      this.child = null;
    }
  }

  private async runCli(prompt: string, invocation: ClaudeCliInvocation): Promise<string | null> {
    const queue = new EventQueue();
    let text = '';
    let errorMessage = '';
    await this.startCli(prompt, invocation, queue);
    for (;;) {
      const event = await queue.next();
      if (!event) break;
      if (event.type === 'text_delta') text += event.text;
      if (event.type === 'error') errorMessage = event.message;
    }
    if (errorMessage) throw new Error(errorMessage);
    return text.trim() || null;
  }

  private async startCli(prompt: string, invocation: ClaudeCliInvocation, queue: EventQueue): Promise<void> {
    if (!this.cliEnv) await this.postInit();
    const runtime = getBackendRuntime(this.config) as ClaudeCliRuntime;
    const executable = runtime.paths?.claudeExecutable;
    if (!executable) throw new Error('Claude Code executable was not found.');
    const spawnConfig = buildClaudeCliSpawn(executable, buildClaudeCliArgs({
      model: invocation.model,
      systemPrompt: invocation.systemPrompt,
      sessionId: invocation.resume ? this.cliSessionId : null,
    }));
    const child = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: this.workingDirectory,
      env: this.cliEnv ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin?.end(prompt);
    this.child = child;
    let buffered = '';
    let stderr = '';
    let lastRetryReason = '';
    let timedOut = false;
    let complete = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finishWithError = (message: string, killChild = true): void => {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      queue.push({ type: 'error', message });
      queue.close();
      if (killChild) child.kill();
      if (this.child === child) this.child = null;
    };
    timeout = setTimeout(() => {
      timedOut = true;
      const detail = sanitizeCliError(stderr) || lastRetryReason;
      finishWithError(detail ? `Claude CLI request timed out: ${detail}` : 'Claude CLI request timed out');
    }, CLAUDE_CLI_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (complete) return;
      buffered += chunk.toString();
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        const retry = this.consumeLine(line, queue, invocation.persistSession);
        if (retry) {
          lastRetryReason = retry.detail;
          if (retry.fatal) {
            finishWithError(retry.userMessage);
            break;
          }
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-2000); });
    child.once('error', (error: Error) => {
      finishWithError(sanitizeCliError(error.message), false);
    });
    child.once('close', (code: number | null) => {
      clearTimeout(timeout);
      if (!complete && buffered.trim()) {
        const retry = this.consumeLine(buffered, queue, invocation.persistSession);
        if (retry) {
          lastRetryReason = retry.detail;
          if (retry.fatal) finishWithError(retry.userMessage, false);
        }
      }
      if (!complete && code && code !== 0 && !timedOut) {
        finishWithError(sanitizeCliError(stderr) || lastRetryReason || `Claude CLI exited with code ${code}`, false);
      }
      if (this.child === child) this.child = null;
      if (!complete) {
        complete = true;
        queue.close();
      }
    });
  }

  private consumeLine(
    line: string,
    queue: EventQueue,
    persistSession: boolean,
  ): { fatal: boolean; detail: string; userMessage: string } | null {
    if (!line.trim()) return null;
    let message: ClaudeCliMessage;
    try {
      message = JSON.parse(line) as ClaudeCliMessage;
    } catch {
      return null;
    }
    if (persistSession && message.session_id && message.session_id !== this.cliSessionId) {
      this.cliSessionId = message.session_id;
      this.config.onSdkSessionIdUpdate?.(message.session_id);
    }
    const retry = describeClaudeCliRetry(message);
    if (retry) return retry;
    if (message.type === 'assistant') {
      const text = message.message?.content
        ?.filter(block => block.type === 'text')
        .map(block => block.text ?? '')
        .join('');
      if (text) queue.push({ type: 'text_delta', text });
    }
    if (message.type === 'result') {
      if (message.subtype === 'success') {
        if (!queue.hasText && message.result) queue.push({ type: 'text_delta', text: message.result });
      } else if (message.error) {
        queue.push({ type: 'error', message: sanitizeCliError(getClaudeCliErrorText(message.error)) });
      }
    }
    return null;
  }

  private buildPrompt(message: string, attachments?: FileAttachment[]): string {
    const attachmentContext = (attachments ?? [])
      .map(attachment => attachment.storedPath || attachment.path ? `[Attached file: ${attachment.name} at ${attachment.storedPath || attachment.path}]` : '')
      .filter(Boolean);
    return [...attachmentContext, message].join('\n\n');
  }

  private buildSystemPrompt(): string {
    return [
      'You are MkAgent, a local coding assistant. Follow workspace instructions and use available tools carefully.',
      ...this.promptBuilder.buildStableContextParts(),
    ].filter(Boolean).join('\n\n');
  }
}

function sanitizeCliError(value: string): string {
  return value
    .replace(/((?:authorization)\s*[:=]\s*bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/((?:api[_ -]?key|auth(?:orization)?|token)\s*[:=]\s*)\S+/gi, '$1[redacted]')
    .slice(-2000)
    .trim();
}

function getClaudeCliErrorText(error: ClaudeCliMessage['error']): string {
  if (typeof error === 'string') return error;
  return [error?.type, error?.error, error?.message].filter(Boolean).join(': ');
}

function describeClaudeCliRetry(message: ClaudeCliMessage): {
  fatal: boolean;
  detail: string;
  userMessage: string;
} | null {
  if (message.type !== 'system' || message.subtype !== 'api_retry') return null;
  const detail = sanitizeCliError(getClaudeCliErrorText(message.error));
  const authFailure = /(?:authentication(?:_failed|\s+failed)?|invalid[_ -]?(?:api[_ -]?key|token|credential)|unauthori[sz]ed|permission_denied)/i.test(detail);
  return {
    fatal: authFailure,
    detail,
    userMessage: 'Claude CLI authentication failed. Check this connection\'s API key and endpoint.',
  };
}

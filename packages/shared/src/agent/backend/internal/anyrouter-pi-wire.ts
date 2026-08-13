/**
 * Private AnyRouter Pi compatibility wire.
 *
 * This intentionally version-pins the observed Claude Code 2.1.227 request
 * shape. It is not a general Anthropic adapter: callers must opt in with the
 * `anyrouter_pi` platform profile.
 */

export const ANYROUTER_PI_PROFILE = 'anyrouter_pi' as const;
export const ANYROUTER_PI_WIRE_VERSION = 'claude-code-2.1.227';

type WireHeadersInit = ConstructorParameters<typeof Headers>[0];

const CLAUDE_CODE_BETA = 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,mid-conversation-system-2026-04-07,effort-2025-11-24,fallback-credit-2026-06-01';
const CLAUDE_CODE_USER_AGENT = 'claude-cli/2.1.227 (external, sdk-cli)';

const CLAUDE_CODE_TOOL_NAMES = [
  'Agent', 'Bash', 'CronCreate', 'CronDelete', 'CronList', 'Edit', 'EnterWorktree',
  'ExitWorktree', 'Glob', 'Grep', 'NotebookEdit', 'Read', 'ReportFindings',
  'ScheduleWakeup', 'SendMessage', 'Skill', 'TaskCreate', 'TaskGet', 'TaskList',
  'TaskOutput', 'TaskStop', 'TaskUpdate', 'WebFetch', 'WebSearch', 'Workflow', 'Write',
] as const;

const ANYROUTER_TO_PI_TOOL_NAME: Readonly<Record<string, string>> = {
  Bash: 'bash', Read: 'read', Write: 'write', Edit: 'edit', Grep: 'grep',
  Glob: 'glob', WebFetch: 'web_fetch', WebSearch: 'web_search', NotebookEdit: 'notebook_edit',
};

export interface AnyRouterPiWireRequest {
  url: string;
  headers?: WireHeadersInit;
  body: Record<string, unknown>;
  sessionId: string;
  deviceId: string;
}

export interface AnyRouterPiWireResult {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function originalSystemText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map(item => item && typeof item === 'object'
      ? String((item as Record<string, unknown>).text ?? '')
      : '')
    .filter(Boolean)
    .join('\n\n');
}

function normalizeMessages(messages: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(messages)) return [];
  return messages.map(message => {
    if (!message || typeof message !== 'object') return message as Record<string, unknown>;
    const current = message as Record<string, unknown>;
    const content = typeof current.content === 'string'
      ? [{ type: 'text', text: current.content }]
      : Array.isArray(current.content) ? current.content : [];
    return { ...current, content };
  });
}

function normalizedToolName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function claudeCodeTools(tools: unknown): Array<Record<string, unknown>> {
  const sourceTools = Array.isArray(tools)
    ? tools.filter((tool): tool is Record<string, unknown> => Boolean(tool) && typeof tool === 'object')
    : [];
  const byName = new Map(sourceTools.map(tool => [normalizedToolName(String(tool.name ?? '')), tool]));

  return CLAUDE_CODE_TOOL_NAMES.map(name => {
    const source = byName.get(normalizedToolName(name));
    if (source) return { ...source, name };
    return {
      name,
      description: `${name} is unavailable in this OPCAgent session. Do not call it.`,
      input_schema: { type: 'object', properties: {} },
    };
  });
}

/** Build the explicit, versioned upstream request used by the Pi profile. */
export function adaptAnyRouterPiRequest(request: AnyRouterPiWireRequest): AnyRouterPiWireResult {
  const headers = new Headers(request.headers);
  const apiKey = headers.get('x-api-key');
  if (!headers.has('authorization') && apiKey) headers.set('authorization', `Bearer ${apiKey}`);
  headers.delete('x-api-key');
  headers.delete('content-length');
  headers.set('accept', 'application/json');
  headers.set('anthropic-version', '2023-06-01');
  headers.set('anthropic-dangerous-direct-browser-access', 'true');
  headers.set('anthropic-beta', CLAUDE_CODE_BETA);
  headers.set('user-agent', CLAUDE_CODE_USER_AGENT);
  headers.set('x-app', 'cli');
  headers.set('x-claude-code-session-id', request.sessionId);
  headers.set('x-stainless-retry-count', '0');
  headers.set('x-stainless-timeout', '600');
  headers.set('x-stainless-lang', 'js');
  headers.set('x-stainless-package-version', '0.94.0');
  headers.set('x-stainless-os', 'Windows');
  headers.set('x-stainless-arch', 'x64');
  headers.set('x-stainless-runtime', 'node');
  headers.set('x-stainless-runtime-version', 'v26.3.0');

  const body = { ...request.body };
  body.model = String(body.model ?? '').replace(/\[1m\]$/i, '');
  body.stream = true;
  body.max_tokens = 64_000;
  body.metadata = {
    user_id: JSON.stringify({
      device_id: request.deviceId,
      account_uuid: '',
      session_id: request.sessionId,
    }),
  };
  body.system = [
    { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.227.7d1; cc_entrypoint=sdk-cli;' },
    {
      type: 'text',
      text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `\nYou are an interactive agent that helps users with software engineering tasks.\n\nIMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or credential theft.\n\n${originalSystemText(body.system)}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
  body.thinking = { type: 'adaptive' };
  body.output_config = { effort: 'high' };
  body.messages = normalizeMessages(body.messages);
  const lastUser = [...(body.messages as Array<Record<string, unknown>>)].reverse()
    .find(message => message.role === 'user');
  const lastContent = lastUser?.content;
  if (Array.isArray(lastContent)) {
    const lastBlock = lastContent.at(-1);
    if (lastBlock && typeof lastBlock === 'object') {
      (lastBlock as Record<string, unknown>).cache_control = { type: 'ephemeral' };
    }
  }
  (body.messages as Array<Record<string, unknown>>).push({
    role: 'system',
    content: "Available agent types for the Agent tool:\n- claude: Catch-all for any task that doesn't fit a more specific agent.\n- Explore: Read-only search agent for broad fan-out searches.",
  });
  body.tools = claudeCodeTools(body.tools);

  const target = new URL('/v1/messages', request.url);
  target.searchParams.set('beta', 'true');
  return { url: target.toString(), headers, body };
}

/** Translate Claude Code-shaped tool-use events back to the Pi tool registry. */
export function adaptAnyRouterPiToolName(name: string): string {
  return ANYROUTER_TO_PI_TOOL_NAME[name] ?? name;
}

/** Translate the common Claude Code file argument names to Pi's tool inputs. */
export function adaptAnyRouterPiToolInput(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...input };
  if (['read', 'write', 'edit', 'glob', 'grep'].includes(toolName) && 'file_path' in result) {
    result.path = result.file_path;
    delete result.file_path;
  }
  if (toolName === 'edit') {
    if ('old_string' in result) {
      result.oldText = result.old_string;
      delete result.old_string;
    }
    if ('new_string' in result) {
      result.newText = result.new_string;
      delete result.new_string;
    }
  }
  return result;
}

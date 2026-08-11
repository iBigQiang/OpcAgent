import type { AgentSession } from '@earendil-works/pi-coding-agent';

type MutableAgentSession = {
  _baseSystemPrompt?: string;
  _rebuildSystemPrompt?: (toolNames: string[]) => string;
};

type AppendedPromptState = {
  defaultPrompt: string;
  prompt: string;
  rebuild?: (toolNames: string[]) => string;
};

const appendedPromptStates = new WeakMap<AgentSession, AppendedPromptState>();

function joinPrompts(base: string, appended: string): string {
  return [base.trim(), appended.trim()].filter(Boolean).join('\n\n');
}

export function shouldPreservePiSystemPrompt(
  baseUrl?: string,
  customEndpoint?: { api?: string },
): boolean {
  return Boolean(baseUrl?.trim() && customEndpoint?.api === 'anthropic-messages');
}

/**
 * Force a system prompt onto a Pi AgentSession.
 *
 * Pi SDK 0.80.6 has no public per-turn system-prompt API. Setting
 * `state.systemPrompt` directly is wiped on every `session.prompt()` call
 * (agent-session.js ~L796: `state.systemPrompt = _baseSystemPrompt`), and
 * `_baseSystemPrompt` itself can be regenerated from the SDK's resource loader
 * when tools change (`setActiveToolsByName`) or extensions reload.
 *
 * This stamps all three internals — `state.systemPrompt`, `_baseSystemPrompt`,
 * and `_rebuildSystemPrompt` — so our prompt survives every reset path.
 *
 * Pattern matches OpenClaw's `applySystemPromptOverrideToSession` (same SDK,
 * same constraint): https://github.com/openclaw/openclaw/blob/main/src/agents/pi-embedded-runner/system-prompt.ts
 *
 * Remove once the SDK exposes a public per-turn system-prompt API.
 */
export function applySystemPromptOverride(session: AgentSession, prompt: string): void {
  session.agent.state.systemPrompt = prompt;
  const mutable = session as unknown as MutableAgentSession;
  mutable._baseSystemPrompt = prompt;
  mutable._rebuildSystemPrompt = () => prompt;
}

/**
 * Keep Pi's generated system prompt and append MkAgent's instructions.
 *
 * Some Anthropic-compatible gateways validate the calling client from the
 * request body. Preserving Pi's default prompt keeps that identity intact,
 * while the wrapper around `_rebuildSystemPrompt` ensures tool/resource
 * refreshes retain the latest MkAgent instructions without duplicating them.
 */
export function applySystemPromptAppend(session: AgentSession, prompt: string): void {
  const mutable = session as unknown as MutableAgentSession;
  let state = appendedPromptStates.get(session);

  if (!state) {
    const createdState: AppendedPromptState = {
      defaultPrompt: mutable._baseSystemPrompt ?? session.agent.state.systemPrompt ?? '',
      prompt,
      rebuild: mutable._rebuildSystemPrompt,
    };
    state = createdState;
    appendedPromptStates.set(session, createdState);

    if (createdState.rebuild) {
      mutable._rebuildSystemPrompt = (toolNames: string[]) => {
        createdState.defaultPrompt = createdState.rebuild!.call(session, toolNames);
        return joinPrompts(createdState.defaultPrompt, createdState.prompt);
      };
    }
  } else {
    state.prompt = prompt;
  }

  const combinedPrompt = joinPrompts(state.defaultPrompt, state.prompt);
  mutable._baseSystemPrompt = combinedPrompt;
  session.agent.state.systemPrompt = combinedPrompt;
}

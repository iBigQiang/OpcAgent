import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AuthStorage, createAgentSession, DefaultResourceLoader, ModelRegistry, SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model } from '@earendil-works/pi-ai';
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared';
import { transformMessages } from '@earendil-works/pi-ai/api/transform-messages';
import { stream as streamAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages';
import { stream as streamGoogle } from '@earendil-works/pi-ai/api/google-generative-ai';
import { stream as streamOpenAI } from '@earendil-works/pi-ai/api/openai-completions';
import { Type } from '@sinclair/typebox';
import { installConnectionHistory, prepareConnectionContext } from './connection-history.ts';
import { restorePiSession } from './session-resume.ts';

const model: Model<'openai-responses'> = {
  id: 'same-model', name: '测试模型', api: 'openai-responses', provider: 'openai',
  baseUrl: 'http://127.0.0.1:1', reasoning: true, input: ['text'], contextWindow: 32000, maxTokens: 2048,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function reply(connectionSlug?: string): AssistantMessage & { opcConnectionSlug?: string } {
  return {
    role: 'assistant', api: model.api, provider: model.provider, model: model.id,
    content: [
      { type: 'thinking', thinking: '已有推理正文', thinkingSignature: '旧思考签名' },
      { type: 'thinking', thinking: '', thinkingSignature: '旧加密推理', redacted: true },
      { type: 'text', text: '已有回答正文', textSignature: '旧响应引用' },
      { type: 'toolCall', id: 'call_1|fc_account_a', name: 'test_tool', arguments: {}, thoughtSignature: '旧工具签名' },
    ],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'toolUse', timestamp: Date.now(), ...(connectionSlug ? { opcConnectionSlug: connectionSlug } : {}),
  };
}

function context(message = reply('account-a')): Context {
  return {
    messages: [message, { role: 'toolResult', toolCallId: 'call_1|fc_account_a', toolName: 'test_tool',
      content: [{ type: 'text', text: '已完成工具结果' }], isError: false, timestamp: Date.now() }],
    tools: [{ name: 'test_tool', description: '当前可用工具', parameters: Type.Object({}) }],
  };
}

describe('Pi 渠道来源与历史兼容', () => {
  it('相同提供商不同账号去除不可移植签名，保留正文与工具配对', () => {
    const original = context();
    const snapshot = JSON.stringify(original);
    const prepared = prepareConnectionContext(original, 'account-b');
    const converted = convertResponsesMessages(model, prepared, new Set(['openai']));
    const wire = JSON.stringify(converted);
    expect(wire).toContain('已有推理正文');
    expect(wire).toContain('已有回答正文');
    expect(wire).toContain('已完成工具结果');
    expect(wire).not.toContain('旧思考签名');
    expect(wire).not.toContain('旧加密推理');
    expect(wire).not.toContain('旧响应引用');
    expect(wire).not.toContain('旧工具签名');
    expect(wire).not.toContain('opcConnectionSlug');
    expect(wire).not.toContain('account-a');
    const call = converted.find(item => item.type === 'function_call');
    const result = converted.find(item => item.type === 'function_call_output');
    expect(call?.call_id).toBe(result?.call_id);
    expect(prepared.tools).toBe(original.tools);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('自定义同名模型 A→B→A 只复用当前来源签名，原历史不被改写', () => {
    const sourceA = { ...reply('a'), provider: 'custom-endpoint' };
    const sourceB = { ...reply('b'), provider: 'custom-endpoint' };
    const target = { ...model, provider: 'custom-endpoint' };
    const history: Context = { messages: [sourceA, sourceB] };
    for (const slug of ['b', 'a']) {
      const prepared = prepareConnectionContext(history, slug);
      const converted = transformMessages(prepared.messages, target).filter(m => m.role === 'assistant');
      for (let index = 0; index < converted.length; index++) {
        const serialized = JSON.stringify(converted[index]);
        expect(serialized.includes('旧思考签名')).toBe((index === 0 ? 'a' : 'b') === slug);
        expect(serialized).toContain('已有回答正文');
        expect(serialized).not.toContain('opcConnectionSlug');
      }
    }
    expect(sourceA.content[0]).toHaveProperty('thinkingSignature', '旧思考签名');
    expect(sourceB.content[0]).toHaveProperty('thinkingSignature', '旧思考签名');
  });

  it('旧历史无来源时保守转换，不把它归属当前账号', () => {
    const original = reply();
    const transformed = transformMessages(prepareConnectionContext(context(original), 'a').messages, model);
    expect(JSON.stringify(transformed)).not.toContain('旧思考签名');
    expect(JSON.stringify(transformed)).toContain('已有回答正文');
    expect(original.opcConnectionSlug).toBeUndefined();
  });

  it('跨协议沿用 SDK 工具 ID 规范化并保持结果配对', () => {
    const target = { ...model, api: 'anthropic-messages' as const, provider: 'anthropic' };
    const transformed = transformMessages(prepareConnectionContext(context(), 'b').messages, target,
      id => id.replace(/[^a-zA-Z0-9_-]/g, '_'));
    const assistant = transformed.find(m => m.role === 'assistant')!;
    const result = transformed.find(m => m.role === 'toolResult')!;
    const call = assistant.content.find(c => c.type === 'toolCall')!;
    expect(call.id).toBe(result.toolCallId);
    expect(call.id).not.toContain('|');
    expect(JSON.stringify(transformed)).not.toContain('旧工具签名');
  });

  for (const protocol of ['openai-completions', 'anthropic-messages', 'google-generative-ai'] as const) {
    for (const supportsImages of [true, false]) {
      it(`真实 ${protocol} 请求保留历史与工具，图片支持为 ${supportsImages}`, async () => {
        const image = { type: 'image' as const, mimeType: 'image/png', data: 'aGlzdG9yeS1pbWFnZQ==' };
        const original = context();
        original.messages.unshift({ role: 'user', content: [{ type: 'text', text: '继续历史图片中的任务' }, image], timestamp: Date.now() });
        const result = original.messages.find(message => message.role === 'toolResult')!;
        result.content.push(image);
        original.messages.push({ role: 'user', content: '接着执行工具', timestamp: Date.now() });
        const before = JSON.stringify(original);
        let captured: Record<string, any> | undefined;
        let requestCount = 0;
        const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
          requestCount++;
          captured = await request.json() as Record<string, any>;
          let chunks: object[];
          if (protocol === 'anthropic-messages') {
            chunks = [
              { type: 'message_start', message: { id: 'local-anthropic', type: 'message', role: 'assistant', model: 'same-model', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '本地继续成功' } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
              { type: 'message_stop' },
            ];
          } else if (protocol === 'google-generative-ai') {
            chunks = [{ candidates: [{ content: { role: 'model', parts: [{ text: '本地继续成功' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 } }];
          } else {
            chunks = [{ id: 'local-openai', object: 'chat.completion.chunk', created: 1, model: 'same-model', choices: [{ index: 0, delta: { role: 'assistant', content: '本地继续成功' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }];
          }
          const payload = chunks.map(chunk => `${protocol === 'anthropic-messages' ? `event: ${(chunk as { type: string }).type}\n` : ''}data: ${JSON.stringify(chunk)}\n\n`).join('');
          return new Response(payload + (protocol === 'openai-completions' ? 'data: [DONE]\n\n' : ''), { headers: { 'content-type': 'text/event-stream' } });
        } });
        try {
          const target = { ...model, baseUrl: `http://127.0.0.1:${server.port}`, reasoning: false,
            input: supportsImages ? ['text', 'image'] as ('text' | 'image')[] : ['text'] as 'text'[] };
          const prepared = prepareConnectionContext(original, 'new-target');
          const options = { apiKey: 'fake-target-key', maxTokens: 64 };
          const stream = protocol === 'anthropic-messages'
            ? streamAnthropic({ ...target, api: protocol, provider: 'anthropic' }, prepared, options)
            : protocol === 'google-generative-ai'
              ? streamGoogle({ ...target, api: protocol, provider: 'google', id: 'gemini-3-test' }, prepared, options)
              : streamOpenAI({ ...target, api: protocol }, prepared, options);
          const response = await stream.result();
          expect(response.stopReason).toBe('stop');
          expect(JSON.stringify(response.content)).toContain('本地继续成功');
          expect(requestCount).toBe(1);
          const wire = JSON.stringify(captured);
          expect(wire).toContain('已有回答正文');
          expect(wire).toContain('已有推理正文');
          expect(wire).toContain('已完成工具结果');
          expect(wire).toContain('当前可用工具');
          for (const secret of ['旧思考签名', '旧加密推理', '旧响应引用', '旧工具签名', 'opcConnectionSlug']) expect(wire).not.toContain(secret);
          if (supportsImages) {
            expect(wire).toContain(image.data);
          } else {
            expect(wire).not.toContain(image.data);
            expect(wire).toContain('(image omitted: model does not support images)');
            expect(wire).toContain('(tool image omitted: model does not support images)');
          }
          if (protocol === 'anthropic-messages') {
            const blocks = captured!.messages.flatMap((message: { content: unknown }) => Array.isArray(message.content) ? message.content : []);
            const call = blocks.find((block: { type: string }) => block.type === 'tool_use');
            const toolResult = blocks.find((block: { type: string }) => block.type === 'tool_result');
            expect(call.id).toMatch(/^[a-zA-Z0-9_-]+$/);
            expect(toolResult.tool_use_id).toBe(call.id);
          } else if (protocol === 'google-generative-ai') {
            const parts = captured!.contents.flatMap((message: { parts: unknown[] }) => message.parts);
            const call = parts.find((part: { functionCall?: unknown }) => part.functionCall).functionCall;
            const toolResult = parts.find((part: { functionResponse?: unknown }) => part.functionResponse).functionResponse;
            expect(call.name).toBe('test_tool');
            expect(toolResult.name).toBe(call.name);
          } else {
            const call = captured!.messages.find((message: { tool_calls?: unknown }) => message.tool_calls).tool_calls[0];
            const toolResult = captured!.messages.find((message: { role: string }) => message.role === 'tool');
            expect(call.id).not.toContain('|');
            expect(toolResult.tool_call_id).toBe(call.id);
          }
          expect(JSON.stringify(original)).toBe(before);
        } finally {
          await server.stop(true);
        }
      });
    }
  }

  it('真实 SDK 在消息保存前标注来源，恢复后保留结果并能执行当前工具', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opc-pi-history-'));
    const agentDir = join(root, 'agent');
    const sessionDir = join(root, 'sessions');
    mkdirSync(agentDir);
    mkdirSync(sessionDir);
    const manager = SessionManager.create(root, sessionDir);
    let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
    let restoredSession: typeof session;
    try {
      const authStorage = AuthStorage.inMemory({ openai: { type: 'api_key', key: 'fake-history-key' } });
      const modelRegistry = ModelRegistry.inMemory(authStorage);
      const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
      const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
      await loader.reload();
      let executions = 0;
      const testTool = { name: 'test_tool', label: '测试', description: '当前可用工具', parameters: Type.Object({}),
        execute: async () => { executions++; return { content: [{ type: 'text' as const, text: '真实工具结果' }], details: {} }; } };
      const options = { cwd: root, agentDir, authStorage, modelRegistry, settingsManager,
        resourceLoader: loader, model, tools: ['test_tool'], customTools: [testTool] };
      session = (await createAgentSession({ ...options, sessionManager: manager })).session;
      let calls = 0;
      session.agent.streamFn = () => {
        const message = reply();
        if (calls++ > 0) { message.content = [{ type: 'text', text: 'A 已完成' }]; message.stopReason = 'stop'; }
        const stream = createAssistantMessageEventStream();
        stream.push({ type: 'done', reason: message.stopReason, message });
        return stream;
      };
      installConnectionHistory(session, 'a');
      await session.prompt('先执行工具');
      expect(executions).toBe(1);
      const savedFile = manager.getSessionFile()!;
      expect(readFileSync(savedFile, 'utf8')).toContain('"opcConnectionSlug":"a"');
      session.dispose();
      session = undefined;
      const restored = SessionManager.continueRecent(root, sessionDir);
      restoredSession = (await createAgentSession({ ...options, sessionManager: restored })).session;
      const captures: Context[] = [];
      let continuedCalls = 0;
      restoredSession.agent.streamFn = (_model, ctx) => {
        captures.push(ctx);
        const message = reply();
        if (continuedCalls++ > 0) { message.content = [{ type: 'text', text: 'B 继续完成' }]; message.stopReason = 'stop'; }
        const stream = createAssistantMessageEventStream();
        stream.push({ type: 'done', reason: message.stopReason, message });
        return stream;
      };
      installConnectionHistory(restoredSession, 'b');
      await restoredSession.prompt('接着执行一次工具');
      expect(executions).toBe(2);
      expect(captures[0]!.tools?.map(t => t.name)).toContain('test_tool');
      expect(captures[0]!.messages.filter(m => m.role === 'toolResult')).toHaveLength(1);
      expect(JSON.stringify(captures[0])).toContain('真实工具结果');
      expect(JSON.stringify(captures[0])).toContain('A 已完成');
      expect(JSON.stringify(captures[0])).not.toContain('opcConnectionSlug');
      expect(readFileSync(savedFile, 'utf8')).toContain('"opcConnectionSlug":"b"');
    } finally {
      session?.dispose();
      restoredSession?.dispose();
      const sessionFile = manager.getSessionFile();
      if (sessionFile) unlinkSync(sessionFile);
      rmdirSync(sessionDir);
      rmdirSync(agentDir);
      rmdirSync(root);
    }
  });

  it('较小上下文目标在续聊前压缩，使用目标认证并保留已有摘要与思考能力降级', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opc-pi-smaller-context-'));
    const agentDir = join(root, 'agent');
    mkdirSync(agentDir);
    const manager = restorePiSession({ cwd: root, sessionPath: root });
    let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
    try {
      manager.appendMessage({ role: 'user', content: '最早任务', timestamp: Date.now() });
      manager.appendMessage({ ...reply('a'), content: [{ type: 'text', text: '早期已完成工作' }], stopReason: 'stop' });
      const kept = manager.appendMessage({ role: 'user', content: '中途材料'.repeat(300), timestamp: Date.now() });
      manager.appendMessage({ ...reply('a'), content: [{ type: 'text', text: '中途决定' }], stopReason: 'stop' });
      manager.appendCompaction('既有摘要：项目代号松风，历史工具已经执行', kept, 10000);
      manager.appendMessage({ role: 'user', content: '最近材料'.repeat(300), timestamp: Date.now() });
      const previous = reply('a');
      manager.appendMessage({ ...previous, content: [{ type: 'text', text: '最近工作已完成' }], stopReason: 'stop',
        timestamp: Date.now() + 10, usage: { ...previous.usage, input: 1800, output: 10, totalTokens: 1810 } });
      const authStorage = AuthStorage.inMemory({ openai: { type: 'api_key', key: 'fake-target-compaction-key' } });
      const modelRegistry = ModelRegistry.inMemory(authStorage);
      const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: 400, keepRecentTokens: 200 }, retry: { enabled: false } });
      const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
      await loader.reload();
      const target = { ...model, id: 'small-no-reasoning', contextWindow: 2000, maxTokens: 256, reasoning: false };
      session = (await createAgentSession({ cwd: root, agentDir, authStorage, modelRegistry, settingsManager,
        resourceLoader: loader, model: target, thinkingLevel: 'high', tools: [],
        sessionManager: restorePiSession({ cwd: root, sessionPath: root, requireExistingSession: true }) })).session;
      expect(session.thinkingLevel).toBe('off');
      expect(session.model?.contextWindow).toBe(2000);
      const captures: Array<{ model: string; context: Context; apiKey?: string }> = [];
      session.agent.streamFn = (requestModel, requestContext, requestOptions) => {
        captures.push({ model: requestModel.id, context: requestContext, apiKey: requestOptions?.apiKey });
        const text = captures.length === 1 ? '新摘要：项目代号松风，历史工具已完成，中途与最近材料已整理' : '使用新渠道继续原任务';
        const message = { ...reply(), model: target.id, content: [{ type: 'text' as const, text }], stopReason: 'stop' as const };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: 'done', reason: 'stop', message });
        return stream;
      };
      installConnectionHistory(session, 'b');
      await session.prompt('沿着原任务继续');
      expect(captures).toHaveLength(2);
      expect(captures.map(capture => capture.model)).toEqual([target.id, target.id]);
      expect(captures[0]!.apiKey).toBe('fake-target-compaction-key');
      expect(JSON.stringify(captures[0]!.context)).toContain('既有摘要：项目代号松风');
      expect(JSON.stringify(captures[0]!.context)).toContain('中途决定');
      expect(JSON.stringify(captures[1]!.context)).toContain('新摘要：项目代号松风');
      expect(JSON.stringify(captures[1]!.context)).toContain('沿着原任务继续');
      session.dispose();
      session = undefined;
      const restored = restorePiSession({ cwd: root, sessionPath: root, requireExistingSession: true });
      expect(restored.getSessionId()).toBe(manager.getSessionId());
      expect(JSON.stringify(restored.buildSessionContext())).toContain('新摘要：项目代号松风');
      expect(JSON.stringify(restored.buildSessionContext())).toContain('使用新渠道继续原任务');
      expect(readFileSync(manager.getSessionFile()!, 'utf8')).toContain('早期已完成工作');
    } finally {
      session?.dispose();
      unlinkSync(manager.getSessionFile()!);
      rmdirSync(join(root, '.pi-sessions'));
      rmdirSync(agentDir);
      rmdirSync(root);
    }
  });
});

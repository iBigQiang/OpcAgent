import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage, Context } from '@earendil-works/pi-ai';

type ConnectionAssistantMessage = AssistantMessage & { opcConnectionSlug?: string };

/** 只调整发送副本，保留日志中的原始签名及渠道来源。 */
export function prepareConnectionContext(context: Context, connectionSlug?: string): Context {
  return {
    ...context,
    messages: context.messages.map(message => {
      if (message.role !== 'assistant') return message;
      const { opcConnectionSlug, ...copy } = message as ConnectionAssistantMessage;
      // SDK 按 provider/api/model 判断签名和工具 ID 是否可复用。
      // 不改目标模型的 provider，避免破坏原生 OAuth 和凭据查找。
      if (!connectionSlug || opcConnectionSlug !== connectionSlug) {
        copy.provider = `opc-foreign:${message.provider}`;
      }
      return copy;
    }),
  };
}

/** SDK 先同步通知订阅者，再保存同一个 message 对象。 */
export function installConnectionHistory(session: AgentSession, connectionSlug?: string): void {
  const originalStream = session.agent.streamFn;
  session.agent.streamFn = (model, context, options) =>
    originalStream(model, prepareConnectionContext(context, connectionSlug), options);

  session.subscribe(event => {
    if (event.type === 'message_end' && event.message.role === 'assistant' && connectionSlug) {
      (event.message as ConnectionAssistantMessage).opcConnectionSlug = connectionSlug;
    }
  });
}

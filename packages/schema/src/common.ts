import { z } from 'zod';

/**
 * 通用基础类型。🔧 提议起点 —— 非最终契约。
 * 流程永远是「先改 schema，再改实现」（PLAN §2.1）。
 */

/** 会话 ID：一个 agent 会话的生命周期标识。 */
export const SessionIdSchema = z.string().min(1).brand<'SessionId'>();
export type SessionId = z.infer<typeof SessionIdSchema>;

/** 消息 / 事件 ID：跨端去重与关联用。 */
export const MessageIdSchema = z.string().min(1).brand<'MessageId'>();
export type MessageId = z.infer<typeof MessageIdSchema>;

/** epoch 毫秒时间戳。 */
export const TimestampSchema = z.number().int().nonnegative();
export type Timestamp = z.infer<typeof TimestampSchema>;

/** 接入的 agent 种类。✅ 四家（CC 命名 ❓，见 PLAN §4.2）。 */
export const AgentKindSchema = z.enum(['claude-code', 'codex', 'opencode', 'pi']);
export type AgentKind = z.infer<typeof AgentKindSchema>;

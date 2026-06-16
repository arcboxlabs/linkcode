import { z } from 'zod';
import { AgentKindSchema, MessageIdSchema, SessionIdSchema, TimestampSchema } from './common';

/**
 * Agent 数据面契约：抽象层把各家 agent 的原生事件归一化为这里的格式（PLAN §4.3）。
 * 🔧 提议起点 —— 字段会随各家 SDK 接入形态确认后调整。
 */

// ── 上行：客户端 → host → agent ──────────────────────────────────────────

/** 启动一个 agent 会话所需的参数。 */
export const StartOptionsSchema = z.object({
  kind: AgentKindSchema,
  /** 工作目录（agent 操作的代码仓库根）。 */
  cwd: z.string().min(1),
  /** 传给 adapter 的自由参数，具体形状待各 SDK 确认。 */
  config: z.record(z.string(), z.unknown()).optional(),
});
export type StartOptions = z.infer<typeof StartOptionsSchema>;

/** 用户发给 agent 的输入，归一化为离散动作。 */
export const AgentInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user-message'), text: z.string() }),
  /** 对一次工具调用的授权决定（PLAN §4.7 perm）。 */
  z.object({
    type: z.literal('tool-approval'),
    callId: z.string().min(1),
    decision: z.enum(['allow', 'deny', 'allow-always']),
  }),
  /** 中断当前生成。 */
  z.object({ type: z.literal('interrupt') }),
]);
export type AgentInput = z.infer<typeof AgentInputSchema>;

// ── 下行：agent → 抽象层（归一化） → 客户端 ──────────────────────────────

/** 工具调用（agent 想执行某个工具 / 命令）。 */
export const ToolCallSchema = z.object({
  callId: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** 归一化后的 agent 事件。 */
export const AgentEventSchema = z.discriminatedUnion('type', [
  /** 助手文本增量（流式）。`done` 标记该消息是否结束。 */
  z.object({
    type: z.literal('assistant-delta'),
    messageId: MessageIdSchema,
    text: z.string(),
    done: z.boolean().default(false),
  }),
  z.object({ type: z.literal('tool-call'), call: ToolCallSchema }),
  z.object({
    type: z.literal('tool-result'),
    callId: z.string().min(1),
    ok: z.boolean(),
    output: z.unknown(),
  }),
  /** 会话状态变化。 */
  z.object({
    type: z.literal('status'),
    status: z.enum(['starting', 'idle', 'running', 'awaiting-input', 'stopped']),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    recoverable: z.boolean().default(true),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

/** 带信封的事件（携带会话与时间信息），便于跨端持久化与排序。 */
export const AgentEventEnvelopeSchema = z.object({
  sessionId: SessionIdSchema,
  ts: TimestampSchema,
  event: AgentEventSchema,
});
export type AgentEventEnvelope = z.infer<typeof AgentEventEnvelopeSchema>;

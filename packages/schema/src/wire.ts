import { z } from 'zod';
import { AgentEventSchema, AgentInputSchema, StartOptionsSchema } from './agent';
import { MessageIdSchema, SessionIdSchema, TimestampSchema } from './common';

/**
 * Wire 协议：transport 层实际传输的信封（PLAN §6）。
 * 本机直连（LocalTransport）与远程隧道（WsTransport）共用同一套格式（PLAN §2.6）。
 * 发送前、接收后都应在信任边界用 zod 校验（PLAN §2.1）。
 * 🔧 提议起点。
 */

export const WIRE_PROTOCOL_VERSION = 1 as const;

/** 信封载荷：按 `kind` 区分的判别联合。 */
export const WirePayloadSchema = z.discriminatedUnion('kind', [
  // ── 会话控制 ──
  z.object({ kind: z.literal('session.start'), opts: StartOptionsSchema }),
  z.object({ kind: z.literal('session.started'), sessionId: SessionIdSchema }),
  z.object({ kind: z.literal('session.stop'), sessionId: SessionIdSchema }),

  // ── 数据面 ──
  z.object({ kind: z.literal('agent.input'), sessionId: SessionIdSchema, input: AgentInputSchema }),
  z.object({ kind: z.literal('agent.event'), sessionId: SessionIdSchema, event: AgentEventSchema }),

  // ── 链路保活 ──
  z.object({ kind: z.literal('ping') }),
  z.object({ kind: z.literal('pong') }),
]);
export type WirePayload = z.infer<typeof WirePayloadSchema>;

/** 完整 wire 消息：版本 + 唯一 id + 时间戳 + 载荷。 */
export const WireMessageSchema = z.object({
  v: z.literal(WIRE_PROTOCOL_VERSION),
  id: MessageIdSchema,
  ts: TimestampSchema,
  payload: WirePayloadSchema,
});
export type WireMessage = z.infer<typeof WireMessageSchema>;

/** 解析 + 校验入站消息，失败返回 zod SafeParse 结果。 */
export function parseWireMessage(input: unknown): z.SafeParseReturnType<unknown, WireMessage> {
  return WireMessageSchema.safeParse(input);
}

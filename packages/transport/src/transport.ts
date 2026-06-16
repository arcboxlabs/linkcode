import type { WireMessage, WirePayload } from '@linkcode/schema';
import { WIRE_PROTOCOL_VERSION } from '@linkcode/schema';

/** 取消订阅。 */
export type Unsubscribe = () => void;

/**
 * transport：通信协议层（PLAN §4.4 / §6）。
 * 只负责「消息怎么传」，承载的永远是 schema 定义的 WireMessage。
 * 上层不感知底层是本地直连还是隧道（PLAN §2.6）。
 */
export interface Transport {
  connect(): Promise<void>;
  /** 发送一条 wire 消息（实现内部应在发送前做 zod 校验）。 */
  send(msg: WireMessage): void;
  /** 订阅入站消息（实现内部应在交付前做 zod 校验）。 */
  onMessage(cb: (msg: WireMessage) => void): Unsubscribe;
  close(): void;
}

let __seq = 0;

/** 构造一条带版本 / id / 时间戳信封的 wire 消息。 */
export function createWireMessage(payload: WirePayload): WireMessage {
  __seq += 1;
  return {
    v: WIRE_PROTOCOL_VERSION,
    id: `${Date.now().toString(36)}-${__seq.toString(36)}` as WireMessage['id'],
    ts: Date.now(),
    payload,
  };
}

/** 简单的监听者集合，给各 transport 实现复用。 */
export class Listeners<T> {
  private readonly set = new Set<(value: T) => void>();

  add(cb: (value: T) => void): Unsubscribe {
    this.set.add(cb);
    return () => {
      this.set.delete(cb);
    };
  }

  emit(value: T): void {
    for (const cb of this.set) cb(value);
  }

  clear(): void {
    this.set.clear();
  }
}

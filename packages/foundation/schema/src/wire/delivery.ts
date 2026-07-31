import type { SessionId } from '../model/primitives';
import type { TerminalId } from '../model/terminal';
import type { WirePayload } from './payload';

type PayloadOf<K extends WirePayload['kind']> = Extract<WirePayload, { kind: K }>;

/** Who a host frame reaches. Absent from the table means every connection. */
export type WireDelivery<P> =
  /** Only connections holding an attachment to the terminal. */
  | { scope: 'terminal'; terminalId: (payload: P) => TerminalId }
  /** Connections that narrowed to `attached` receive it only for sessions they attached to. */
  | { scope: 'session'; sessionId: (payload: P) => SessionId }
  /** The single connection registered as the browser host. */
  | { scope: 'browser-host' };

type WireDeliveryTable = {
  [K in WirePayload['kind']]?: WireDelivery<PayloadOf<K>>;
};

/**
 * The frames that are not plain broadcasts. A host→client frame carrying a resource id belongs
 * here; leaving it out costs bytes on every connection rather than correctness.
 */
export const WIRE_DELIVERY: WireDeliveryTable = {
  'terminal.output': { scope: 'terminal', terminalId: (p) => p.terminalId },
  'terminal.resized': { scope: 'terminal', terminalId: (p) => p.terminalId },
  'terminal.controller.changed': { scope: 'terminal', terminalId: (p) => p.terminalId },
  'terminal.exit': { scope: 'terminal', terminalId: (p) => p.terminalId },
  'agent.event': { scope: 'session', sessionId: (p) => p.sessionId },
  'simulator.stream.frame': { scope: 'session', sessionId: (p) => p.sessionId },
  'browser.command': { scope: 'browser-host' },
};

/** The delivery rule for one payload, or null when it reaches every connection. */
export function deliveryOf(payload: WirePayload): WireDelivery<WirePayload> | null {
  return (WIRE_DELIVERY[payload.kind] as WireDelivery<WirePayload> | undefined) ?? null;
}

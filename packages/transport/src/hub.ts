import type {
  SessionId,
  TerminalAttachmentCredentials,
  TerminalAttachmentId,
  TerminalId,
  WireMessage,
} from '@linkcode/schema';
import { noop } from 'foxts/noop';
import type { Transport, Unsubscribe } from './transport';
import { createWireMessage, Listeners } from './transport';

/** Connection-scoped `agent.event` delivery, driven by `subscription.set` / `session.attach|detach`. */
interface ConnectionSubscription {
  /** `all` (the default) mirrors the historical broadcast; `attached` narrows to attached sessions. */
  mode: 'all' | 'attached';
  attached: Set<SessionId>;
  /** Terminal attachments owned by this connection, retained so disconnect can detach them. */
  terminals: Map<TerminalId, Map<TerminalAttachmentId, string>>;
}

interface PendingTerminalRequest extends TerminalAttachmentCredentials {
  conn: Transport;
}

/**
 * Composes many client connections into the single `Transport` the daemon's `Host` consumes.
 * Correlated replies return only to their request's connection; session events keep their
 * broadcast/scoped behavior; terminal events go only to connections attached to that terminal.
 * A connection close becomes `terminal.detach` frames, so attachment lifetime follows the real
 * peer. Subscription state is connection-scoped, so the Hub owns it: `subscription.set` is
 * answered here and never reaches the Host; `session.attach`/`session.detach` update the
 * subscription and are still forwarded.
 */
export class Hub implements Transport {
  private readonly conns = new Set<Transport>();
  private readonly unsubs = new Map<Transport, Unsubscribe>();
  private readonly subscriptions = new Map<Transport, ConnectionSubscription>();
  /** Kept through origin disconnect so a late host reply cannot collide with a reused request id. */
  private readonly pendingReplies = new Map<string, Transport>();
  private readonly pendingTerminals = new Map<string, PendingTerminalRequest>();
  private readonly inbound = new Listeners<WireMessage>();
  private readonly closed = new Listeners<void>();

  /** Register a client connection; its inbound messages are forwarded to the Host. */
  addConnection(conn: Transport): void {
    if (this.conns.has(conn)) return;
    this.conns.add(conn);
    this.subscriptions.set(conn, { mode: 'all', attached: new Set(), terminals: new Map() });
    this.unsubs.set(
      conn,
      conn.onMessage((msg) => this.route(conn, msg)),
    );
  }

  /** Drop a client connection (e.g. on socket close). */
  removeConnection(conn: Transport): void {
    this.unsubs.get(conn)?.();
    this.unsubs.delete(conn);
    this.conns.delete(conn);
    const subscription = this.subscriptions.get(conn);
    this.subscriptions.delete(conn);
    if (!subscription) return;
    for (const [terminalId, attachments] of subscription.terminals) {
      for (const [attachmentId, attachmentSecret] of attachments) {
        this.inbound.emit(
          createWireMessage({
            kind: 'terminal.detach',
            terminalId,
            attachmentId,
            attachmentSecret,
          }),
        );
      }
    }
  }

  /** Number of currently attached clients. */
  get size(): number {
    return this.conns.size;
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  private route(conn: Transport, msg: WireMessage): void {
    const p = msg.payload;
    const subscription = this.subscriptions.get(conn);
    if ('clientReqId' in p && this.pendingReplies.has(p.clientReqId)) {
      bestEffort(() =>
        conn.send(
          createWireMessage({
            kind: 'request.failed',
            replyTo: p.clientReqId,
            message: 'duplicate clientReqId',
          }),
        ),
      );
      return;
    }
    if (subscription) {
      if (p.kind === 'subscription.set') {
        subscription.mode = p.mode;
        bestEffort(() =>
          conn.send(createWireMessage({ kind: 'request.succeeded', replyTo: p.clientReqId })),
        );
        return;
      }
      if (p.kind === 'ping') {
        bestEffort(() => conn.send(createWireMessage({ kind: 'pong' })));
        return;
      }
      if (p.kind === 'session.attach') subscription.attached.add(p.sessionId);
      else if (p.kind === 'session.detach') subscription.attached.delete(p.sessionId);
      else if (p.kind === 'terminal.detach') {
        const attachments = subscription.terminals.get(p.terminalId);
        if (attachments?.get(p.attachmentId) === p.attachmentSecret) {
          attachments.delete(p.attachmentId);
          if (attachments.size === 0) subscription.terminals.delete(p.terminalId);
        }
      }
    }
    if ('clientReqId' in p) {
      this.pendingReplies.set(p.clientReqId, conn);
      if (p.kind === 'terminal.open' || p.kind === 'terminal.attach') {
        this.pendingTerminals.set(p.clientReqId, {
          conn,
          attachmentId: p.attachmentId,
          attachmentSecret: p.attachmentSecret,
        });
      }
    }
    this.inbound.emit(msg);
  }

  /** Route one host frame; one failing connection never blocks the others. */
  send(msg: WireMessage): void {
    const p = msg.payload;
    if ('replyTo' in p) {
      const conn = this.pendingReplies.get(p.replyTo);
      const pendingTerminal = this.pendingTerminals.get(p.replyTo);
      this.pendingReplies.delete(p.replyTo);
      this.pendingTerminals.delete(p.replyTo);

      if (pendingTerminal && (p.kind === 'terminal.opened' || p.kind === 'terminal.attached')) {
        const terminalId = p.terminal.terminalId;
        if (this.conns.has(pendingTerminal.conn)) {
          this.addTerminalAttachment(terminalId, pendingTerminal);
        } else {
          // The PTY operation completed after its peer disconnected: detach the capability now.
          this.inbound.emit(
            createWireMessage({
              kind: 'terminal.detach',
              terminalId,
              attachmentId: pendingTerminal.attachmentId,
              attachmentSecret: pendingTerminal.attachmentSecret,
            }),
          );
        }
      }
      if (conn && this.conns.has(conn)) bestEffort(() => conn.send(msg));
      return;
    }

    if (
      p.kind === 'terminal.output' ||
      p.kind === 'terminal.resized' ||
      p.kind === 'terminal.controller.changed' ||
      p.kind === 'terminal.exit'
    ) {
      for (const conn of this.conns) {
        if (!this.subscriptions.get(conn)?.terminals.has(p.terminalId)) continue;
        bestEffort(() => conn.send(msg));
      }
      if (p.kind === 'terminal.exit') {
        for (const subscription of this.subscriptions.values()) {
          subscription.terminals.delete(p.terminalId);
        }
      }
      return;
    }

    for (const conn of this.conns) {
      if (p.kind === 'agent.event') {
        const subscription = this.subscriptions.get(conn);
        if (subscription?.mode === 'attached' && !subscription.attached.has(p.sessionId)) {
          continue;
        }
      }
      // A dead/closing socket shouldn't break the broadcast; it will be removed on its close event.
      bestEffort(() => conn.send(msg));
    }
  }

  private addTerminalAttachment(terminalId: TerminalId, attachment: PendingTerminalRequest): void {
    const subscription = this.subscriptions.get(attachment.conn);
    if (!subscription) return;
    let attachments = subscription.terminals.get(terminalId);
    if (!attachments) {
      attachments = new Map();
      subscription.terminals.set(terminalId, attachments);
    }
    attachments.set(attachment.attachmentId, attachment.attachmentSecret);
  }

  onMessage(cb: (msg: WireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  onClose(cb: () => void): Unsubscribe {
    return this.closed.add(cb);
  }

  close(): void {
    for (const conn of this.conns) {
      // Closing is best-effort during daemon shutdown.
      bestEffort(() => conn.close());
    }
    for (const unsub of this.unsubs.values()) unsub();
    this.conns.clear();
    this.unsubs.clear();
    this.subscriptions.clear();
    this.pendingReplies.clear();
    this.pendingTerminals.clear();
    this.inbound.clear();
    this.closed.emit();
  }
}

/** Run an operation that may throw synchronously or reject asynchronously, swallowing either. */
function bestEffort(fn: () => void | Promise<void>): void {
  try {
    void Promise.resolve(fn()).catch(noop);
  } catch {
    // Best-effort: the caller doesn't need to know.
  }
}

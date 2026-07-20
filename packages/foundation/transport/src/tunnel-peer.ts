import { TunnelChunkAssembler } from '@linkcode/tunnel';
import { Listeners } from './transport';

export interface TunnelPeer {
  readonly id: string;
  send(message: string): void;
  onMessage(cb: (message: string) => void): () => void;
  onClose(cb: () => void): () => void;
}

export class PeerConnection implements TunnelPeer {
  private readonly inbound = new Listeners<string>();
  private readonly closed = new Listeners<void>();
  private readonly assembler = new TunnelChunkAssembler();
  private open = true;

  constructor(
    readonly id: string,
    private readonly sendMessage: (peerId: string, message: string) => void,
  ) {}

  send(message: string): void {
    if (!this.open) throw new Error('TunnelPeer: connection closed');
    this.sendMessage(this.id, message);
  }

  onMessage(cb: (message: string) => void): () => void {
    return this.inbound.add(cb);
  }

  onClose(cb: () => void): () => void {
    return this.closed.add(cb);
  }

  receive(data: string | ArrayBuffer): void {
    if (!this.open) return;
    const message = typeof data === 'string' ? data : this.assembler.push(data);
    if (message !== null) this.inbound.emit(message);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.assembler.reset();
    this.inbound.clear();
    this.closed.emit();
    this.closed.clear();
  }
}

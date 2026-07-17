import type { LocalTransport } from '@linkcode/transport';
import { createLocalTransportPair, createWireMessage } from '@linkcode/transport';
import type { LinkCodeClientOptions } from '../client';
import { LinkCodeClient } from '../client';

export async function createConnectedLocalClient(options?: LinkCodeClientOptions): Promise<{
  client: LinkCodeClient;
  serverTransport: LocalTransport;
}> {
  const [clientTransport, serverTransport] = createLocalTransportPair();
  await serverTransport.connect();
  serverTransport.onMessage((message) => {
    if (message.payload.kind === 'ping') {
      serverTransport.send(createWireMessage({ kind: 'pong' }));
    }
  });
  const client = new LinkCodeClient(clientTransport, options);
  await client.connect();
  return { client, serverTransport };
}

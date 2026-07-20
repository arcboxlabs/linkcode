/// <reference types="node" />

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';

export interface LocalServer {
  url: string;
  /** Request paths in arrival order. */
  requests: string[];
  close(): Promise<void>;
}

/** Loopback HTTP server on an ephemeral port — the repo's stand-in for HTTP mocking libs. */
export async function startLocalServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<LocalServer> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? '');
    handler(req, res);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address !== 'object') throw new Error('server has no address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

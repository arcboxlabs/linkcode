import { createServer } from 'node:net';

/** Ask the OS for a free loopback port: bind 0, read it back, close (paseo's approach). */
export function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('port allocation returned no address'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

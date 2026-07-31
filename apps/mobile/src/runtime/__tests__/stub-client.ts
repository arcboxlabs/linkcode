import type { LinkCodeClient } from '@linkcode/client-core';

/**
 * A `LinkCodeClient` carrying only the methods a hook under test actually calls. The real client
 * needs a live transport and a handshake, and these are unit tests of the hooks around it.
 */
export function stubClient(methods: Partial<LinkCodeClient>): LinkCodeClient {
  // eslint-disable-next-line sukka/type/no-force-cast-via-top-type -- private fields make a partial stub structurally unassignable
  return methods as unknown as LinkCodeClient;
}

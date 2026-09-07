import type { LinkCodeClient } from '@linkcode/client-core';
import type { SessionId } from '@linkcode/schema';

// Prompt text crosses the route boundary in memory, never in a deep link or navigation URL.
const prompts = new WeakMap<LinkCodeClient, Map<SessionId, string>>();

export function queueInitialSessionPrompt(
  client: LinkCodeClient,
  sessionId: SessionId,
  text: string,
): void {
  let pending = prompts.get(client);
  if (!pending) {
    pending = new Map();
    prompts.set(client, pending);
  }
  pending.set(sessionId, text);
}

export function readInitialSessionPrompt(client: LinkCodeClient, sessionId: SessionId): string {
  return prompts.get(client)?.get(sessionId) ?? '';
}

export function takeInitialSessionPrompt(client: LinkCodeClient, sessionId: SessionId): string {
  const text = readInitialSessionPrompt(client, sessionId);
  prompts.get(client)?.delete(sessionId);
  return text;
}

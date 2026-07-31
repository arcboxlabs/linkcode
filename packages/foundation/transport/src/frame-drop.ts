import type { WireParseFailure } from '@linkcode/schema';

/**
 * Reports refused frames without drowning the log: a peer one version ahead sends the same unknown
 * kind on every frame, so each distinct reason is reported once per connection.
 */
export function createFrameDropReporter(label: string): (failure: WireParseFailure) => void {
  const reported = new Set<string>();
  return (failure) => {
    const key = failureKey(failure);
    if (reported.has(key)) return;
    reported.add(key);
    console.warn(`[LinkCode] ${label} dropped a frame: ${describe(failure)}`);
  };
}

function failureKey(failure: WireParseFailure): string {
  switch (failure.reason) {
    case 'unsupported-version':
      return `${failure.reason}:${failure.version}`;
    case 'unknown-kind':
    case 'invalid-payload':
      return `${failure.reason}:${failure.kind}`;
    default:
      return failure.reason;
  }
}

function describe(failure: WireParseFailure): string {
  switch (failure.reason) {
    case 'unsupported-version':
      return `peer speaks wire v${failure.version}, older than this build accepts`;
    case 'unknown-kind':
      return `unknown kind "${failure.kind}" (newer peer)`;
    case 'invalid-payload':
      return `malformed "${failure.kind}" payload`;
    default:
      return 'malformed envelope';
  }
}

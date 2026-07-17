export type StartupTarget =
  | { kind: 'sign-in' }
  | { kind: 'connect' }
  | { kind: 'host'; hostId: string };

/**
 * Startup destination: saved hosts win (last active first); otherwise signed-in
 * lands on the machine list, signed-out on first-run sign-in.
 */
export function resolveStartupTarget(input: {
  hosts: ReadonlyArray<{ id: string }>;
  lastActiveHostId: string | null;
  signedIn: boolean;
}): StartupTarget {
  if (input.hosts.length === 0) return { kind: input.signedIn ? 'connect' : 'sign-in' };
  const target = input.hosts.find((host) => host.id === input.lastActiveHostId) ?? input.hosts[0];
  return { kind: 'host', hostId: target.id };
}

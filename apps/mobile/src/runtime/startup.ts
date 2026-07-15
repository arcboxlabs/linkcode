export type StartupTarget =
  | { kind: 'sign-in' }
  | { kind: 'connect' }
  | { kind: 'host'; hostId: string };

/**
 * Where the startup screen lands once the host registry and account state
 * have both loaded: saved hosts win (last active first), otherwise a
 * signed-in user gets the machine list and a signed-out one first-run
 * sign-in.
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

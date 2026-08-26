import type { AgentKind } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';

const RE_SERVICE_ID = /^[a-z][a-z0-9-]{0,62}$/;

/** `null` means unrestricted — every agent/service is allowed. A brand only ever narrows this. */
export interface DesktopAgentRestrictions {
  readonly allowedAgents: readonly AgentKind[] | null;
  readonly allowedServices: readonly string[] | null;
}

const UNRESTRICTED: DesktopAgentRestrictions = { allowedAgents: null, allowedServices: null };

/**
 * The build-time agent/service restriction snapshot (CODE-618): rendered by the pinned config
 * publisher onto the config build bundle, inlined by vite.main.config.mts as
 * MAIN_VITE_AGENT_RESTRICTIONS next to MAIN_VITE_BRAND_IDENTITY (see brand.ts). Absent means the
 * default unrestricted build; a present-but-invalid snapshot aborts boot instead of silently
 * falling back to unrestricted, so a tampered or stale artifact can never widen access.
 */
export function parseDesktopAgentRestrictions(raw: string | undefined): DesktopAgentRestrictions {
  if (raw === undefined || raw === '') return UNRESTRICTED;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('agent restrictions must be an object');
  }
  const { agents, services, ...rest } = parsed as Record<string, unknown>;
  const unsupported = Object.keys(rest).at(0);
  if (unsupported !== undefined) {
    throw new TypeError(`agent restrictions contains unsupported field ${unsupported}`);
  }
  return {
    allowedAgents: agents === undefined ? null : assertAgents(agents),
    allowedServices: services === undefined ? null : assertServices(services),
  };
}

function assertNonEmptyUniqueArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  if (new Set(value).size !== value.length) {
    throw new TypeError(`${label} must not contain duplicates`);
  }
  return value as T[];
}

function assertAgents(value: unknown): AgentKind[] {
  const agents = assertNonEmptyUniqueArray<unknown>(value, 'agents');
  return agents.map((agent) => AgentKindSchema.parse(agent));
}

function assertServices(value: unknown): string[] {
  const services = assertNonEmptyUniqueArray<unknown>(value, 'services');
  return services.map((service) => {
    if (typeof service !== 'string' || !RE_SERVICE_ID.test(service)) {
      throw new TypeError(`services contains an invalid service id ${String(service)}`);
    }
    return service;
  });
}

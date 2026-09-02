/// <reference types="unplugin-icons/types/react" />
import SiAsana from '~icons/simple-icons/asana';
import SiAtlassian from '~icons/simple-icons/atlassian';
import SiCloudflare from '~icons/simple-icons/cloudflare';
import SiFigma from '~icons/simple-icons/figma';
import SiGithub from '~icons/simple-icons/github';
import SiGmail from '~icons/simple-icons/gmail';
import SiGoogledrive from '~icons/simple-icons/googledrive';
import SiIntercom from '~icons/simple-icons/intercom';
import SiLinear from '~icons/simple-icons/linear';
import SiNotion from '~icons/simple-icons/notion';
import SiPostgresql from '~icons/simple-icons/postgresql';
import SiSentry from '~icons/simple-icons/sentry';
import SiSlack from '~icons/simple-icons/slack';
import SiStripe from '~icons/simple-icons/stripe';
import SiSupabase from '~icons/simple-icons/supabase';
import SiVercel from '~icons/simple-icons/vercel';
import { cn } from '../lib/cn';

/** Brand glyphs for well-known integrations, keyed by the token found in an MCP server name.
 * Static imports only — never construct a virtual icon path dynamically. */
const INTEGRATION_GLYPHS = {
  asana: SiAsana,
  atlassian: SiAtlassian,
  cloudflare: SiCloudflare,
  figma: SiFigma,
  github: SiGithub,
  gmail: SiGmail,
  googledrive: SiGoogledrive,
  intercom: SiIntercom,
  jira: SiAtlassian,
  linear: SiLinear,
  notion: SiNotion,
  postgres: SiPostgresql,
  postgresql: SiPostgresql,
  sentry: SiSentry,
  slack: SiSlack,
  stripe: SiStripe,
  supabase: SiSupabase,
  vercel: SiVercel,
} as const;

export type IntegrationBrand = keyof typeof INTEGRATION_GLYPHS;

/** Proper brand casing for labels ("Used Linear 2 times"). */
export const INTEGRATION_LABELS: Record<IntegrationBrand, string> = {
  asana: 'Asana',
  atlassian: 'Atlassian',
  cloudflare: 'Cloudflare',
  figma: 'Figma',
  github: 'GitHub',
  gmail: 'Gmail',
  googledrive: 'Google Drive',
  intercom: 'Intercom',
  jira: 'Jira',
  linear: 'Linear',
  notion: 'Notion',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  sentry: 'Sentry',
  slack: 'Slack',
  stripe: 'Stripe',
  supabase: 'Supabase',
  vercel: 'Vercel',
};

const RE_SERVER_TOKEN_BOUNDARY = /[^a-z0-9]+/;

/** MCP server names are user-chosen config keys (`linear`, `claude_ai_Gmail`, opaque ids) —
 * token-match them against the known brands; no match means no branding. */
export function integrationBrand(server: string): IntegrationBrand | undefined {
  const tokens = server.toLowerCase().split(RE_SERVER_TOKEN_BOUNDARY);
  for (let i = 0, len = tokens.length; i < len; i++) {
    const token = tokens[i];
    // Own-key check: `in` would also match prototype keys ("constructor" is a valid token).
    if (Object.hasOwn(INTEGRATION_GLYPHS, token)) return token as IntegrationBrand;
  }
  return undefined;
}

export function IntegrationIcon({
  brand,
  className,
}: {
  brand: IntegrationBrand;
  className?: string;
}): React.ReactNode {
  const Glyph = INTEGRATION_GLYPHS[brand];
  return <Glyph aria-hidden className={cn('size-3.5 shrink-0', className)} data-brand={brand} />;
}

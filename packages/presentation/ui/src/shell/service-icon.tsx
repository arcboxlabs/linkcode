/// <reference types="unplugin-icons/types/react" />

import AnthropicGlyph from '~icons/lobe-icons/anthropic';
import ClaudeColorGlyph from '~icons/lobe-icons/claude-color';
import CloudflareColorGlyph from '~icons/lobe-icons/cloudflare-color';
import DeepSeekColorGlyph from '~icons/lobe-icons/deepseek-color';
import OpenAiGlyph from '~icons/lobe-icons/openai';
import OpenRouterGlyph from '~icons/lobe-icons/openrouter';
import VercelGlyph from '~icons/lobe-icons/vercel';
import XaiGlyph from '~icons/lobe-icons/xai';
import { cn } from '../lib/cn';

function LinkCodeGlyph(props: React.SVGProps<SVGSVGElement>): React.ReactNode {
  return (
    <svg viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <rect x="39" y="65" width="27" height="55" rx="10" fill="currentColor" />
      <rect x="95" y="65" width="28" height="55" rx="10" fill="currentColor" />
      <rect x="123" y="120" width="27" height="27" rx="10" fill="currentColor" />
      <rect x="66" y="120" width="29" height="27" rx="10" fill="currentColor" />
      <rect x="123" y="38" width="27" height="27" rx="10" fill="rgb(255 0 0)" />
    </svg>
  );
}

/** Brand glyphs keyed by `Account.service` (a string join key, like `AgentKind` for `AgentIcon`);
 * color variants only where lobe-icons ships one, the rest render in currentColor. A missing key
 * deliberately falls back to label initials, so custom services need no wiring. */
const SERVICE_GLYPHS: Record<string, typeof AnthropicGlyph> = {
  'claude-sub': ClaudeColorGlyph,
  'chatgpt-sub': OpenAiGlyph,
  'anthropic-api': AnthropicGlyph,
  'openai-api': OpenAiGlyph,
  xai: XaiGlyph,
  deepseek: DeepSeekColorGlyph,
  openrouter: OpenRouterGlyph,
  'vercel-gateway': VercelGlyph,
  'cloudflare-gateway': CloudflareColorGlyph,
  'cloudflare-anthropic': CloudflareColorGlyph,
};

const WHITESPACE = /\s+/;

function initials(label: string): string {
  const words = label.split(WHITESPACE).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

export function ServiceIcon({
  service,
  label,
  className,
}: {
  /** `Account.service` catalog key; absent (custom accounts) falls back to label initials. */
  service?: string;
  label: string;
  className?: string;
}): React.ReactNode {
  const Glyph = service === undefined ? undefined : SERVICE_GLYPHS[service];
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted font-semibold text-xs text-foreground',
        className,
      )}
    >
      {service === 'linkcode-gateway' ? (
        <LinkCodeGlyph aria-hidden className="size-4" />
      ) : Glyph ? (
        <Glyph aria-hidden className="size-4" />
      ) : (
        initials(label)
      )}
    </span>
  );
}

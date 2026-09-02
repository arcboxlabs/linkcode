/// <reference types="unplugin-icons/types/react" />
import type { AgentKind } from '@linkcode/schema';
import ClaudeGlyph from '~icons/lobe-icons/claude';
import ClaudeColorGlyph from '~icons/lobe-icons/claude-color';
import CodexGlyph from '~icons/lobe-icons/codex';
import CodexColorGlyph from '~icons/lobe-icons/codex-color';
import GrokGlyph from '~icons/lobe-icons/grok';
import OpenCodeGlyph from '~icons/lobe-icons/opencode';
import { AGENT_INITIALS } from '../agent-meta';
import { cn } from '../lib/cn';

export { AGENT_LABELS } from '../agent-meta';

type AgentGlyph = React.ComponentType<React.SVGProps<SVGSVGElement>>;

const AGENT_GLYPHS: Partial<Record<AgentKind, AgentGlyph>> = {
  'claude-code': ClaudeGlyph,
  codex: CodexGlyph,
  'grok-build': GrokGlyph,
  opencode: OpenCodeGlyph,
  pi: PiGlyph,
};

const AGENT_COLOR_GLYPHS: Partial<Record<AgentKind, AgentGlyph>> = {
  'claude-code': ClaudeColorGlyph,
  codex: CodexColorGlyph,
};

function PiGlyph(props: React.SVGProps<SVGSVGElement>): React.ReactNode {
  return (
    <svg viewBox="0 0 800 800" {...props}>
      <path
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path d="M517.36 400H634.72V634.72H517.36Z" fill="currentColor" />
    </svg>
  );
}

export function AgentIcon({
  kind,
  variant = 'solid',
  className,
}: {
  kind: AgentKind;
  /** `ghost` inherits text color; `brand` uses an official color glyph when one exists. */
  variant?: 'solid' | 'ghost' | 'brand';
  className?: string;
}): React.ReactNode {
  const Glyph = AGENT_GLYPHS[kind];

  if (variant === 'brand') {
    const ColorGlyph = AGENT_COLOR_GLYPHS[kind];
    return (
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center font-semibold text-foreground text-xs',
          className,
        )}
      >
        {ColorGlyph ? (
          <ColorGlyph aria-hidden className="size-4" />
        ) : Glyph ? (
          <Glyph aria-hidden className="size-4" />
        ) : (
          AGENT_INITIALS[kind]
        )}
      </span>
    );
  }

  if (variant === 'ghost') {
    return (
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center font-semibold text-xs',
          className,
        )}
      >
        {Glyph ? <Glyph aria-hidden className="size-4" /> : AGENT_INITIALS[kind]}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground text-xs',
        className,
      )}
    >
      {Glyph ? <Glyph aria-hidden className="size-3.5" /> : AGENT_INITIALS[kind]}
    </span>
  );
}

/// <reference types="unplugin-icons/types/react" />
import type { AgentKind } from '@linkcode/schema';
import ClaudeCodeGlyph from '~icons/lobe-icons/claudecode';
import ClaudeCodeColorGlyph from '~icons/lobe-icons/claudecode-color';
import CodexGlyph from '~icons/lobe-icons/codex';
import CodexColorGlyph from '~icons/lobe-icons/codex-color';
import OpenCodeGlyph from '~icons/lobe-icons/opencode';
import { AGENT_INITIALS } from '../agent-meta';
import { cn } from '../lib/cn';

export { AGENT_LABELS } from '../agent-meta';

const AGENT_GLYPHS: Partial<Record<AgentKind, typeof ClaudeCodeGlyph>> = {
  'claude-code': ClaudeCodeGlyph,
  codex: CodexGlyph,
  opencode: OpenCodeGlyph,
};

const AGENT_COLOR_GLYPHS: Partial<Record<AgentKind, typeof ClaudeCodeColorGlyph>> = {
  'claude-code': ClaudeCodeColorGlyph,
  codex: CodexColorGlyph,
};

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

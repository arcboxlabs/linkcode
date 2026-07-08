/// <reference types="unplugin-icons/types/react" />
import type { AgentKind } from '@linkcode/schema';
import AmpGlyph from '~icons/lobe-icons/amp';
import ClaudeCodeGlyph from '~icons/lobe-icons/claudecode';
import CodexGlyph from '~icons/lobe-icons/codex';
import OpenCodeGlyph from '~icons/lobe-icons/opencode';
import { cn } from '../lib/cn';

// Key order is picker order (SELECTABLE_PROVIDERS derives from Object.keys): amp stays last.
export const AGENT_LABELS: Record<AgentKind, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  pi: 'Pi',
  amp: 'Amp',
};

// Fallback for kinds without a brand glyph (e.g. `pi`).
const AGENT_INITIALS: Record<AgentKind, string> = {
  'claude-code': 'CC',
  codex: 'CX',
  opencode: 'OC',
  pi: 'PI',
  amp: 'AM',
};

const AGENT_GLYPHS: Partial<Record<AgentKind, typeof ClaudeCodeGlyph>> = {
  'claude-code': ClaudeCodeGlyph,
  codex: CodexGlyph,
  opencode: OpenCodeGlyph,
  amp: AmpGlyph,
};

export function AgentIcon({
  kind,
  variant = 'solid',
  className,
}: {
  kind: AgentKind;
  /** `ghost` drops the brand-chip box: bare glyph, color inherited from the surrounding text. */
  variant?: 'solid' | 'ghost';
  className?: string;
}): React.ReactNode {
  const Glyph = AGENT_GLYPHS[kind];

  if (variant === 'ghost') {
    return (
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center font-semibold text-[0.625rem]',
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

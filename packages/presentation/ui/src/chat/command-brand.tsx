import type { AgentCommand } from '@linkcode/schema';
import { BookTextIcon } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '../lib/cn';
import { buildCommandLookup, CommandCatalogContext } from './command-catalog';

/** A provider-branded command's glyph: its own icon, else a brandColor-tinted initial chip, else
 * the shared book glyph. One shape for menu rows, directive chips, and transcript echoes. */
export function CommandBrandGlyph({
  command,
  className,
}: {
  command?: Pick<AgentCommand, 'brandColor' | 'displayName' | 'iconDataUri' | 'name'>;
  className?: string;
}): React.ReactNode {
  if (command?.iconDataUri) {
    return (
      <img alt="" className={cn('shrink-0 rounded-xs', className)} src={command.iconDataUri} />
    );
  }
  if (command?.brandColor) {
    return (
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center rounded-xs font-medium text-2xs text-white uppercase',
          className,
        )}
        style={{ backgroundColor: command.brandColor }}
      >
        {(command.displayName ?? command.name).slice(0, 1)}
      </span>
    );
  }
  return <BookTextIcon aria-hidden className={cn('shrink-0 opacity-80', className)} />;
}

export function CommandCatalogProvider({
  commands,
  children,
}: {
  commands: readonly AgentCommand[] | null;
  children: React.ReactNode;
}): React.ReactNode {
  // Catalog updates are full-replace, so `commands` identity is the correct invalidation key.
  const lookup = useMemo(
    () => (commands === null ? null : buildCommandLookup(commands)),
    [commands],
  );
  return <CommandCatalogContext.Provider value={lookup}>{children}</CommandCatalogContext.Provider>;
}

import type { AgentCommand } from '@linkcode/schema';
import { BookTextIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import { buildCommandLookup, CommandCatalogContext } from './command-catalog';

type BrandedCommand = Pick<AgentCommand, 'brandColor' | 'displayName' | 'iconDataUri' | 'name'>;

function linearizeColorChannel(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function brandInitialForeground(brandColor: string): string {
  const red = linearizeColorChannel(Number.parseInt(brandColor.slice(1, 3), 16) / 255);
  const green = linearizeColorChannel(Number.parseInt(brandColor.slice(3, 5), 16) / 255);
  const blue = linearizeColorChannel(Number.parseInt(brandColor.slice(5, 7), 16) / 255);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.179 ? 'rgb(0 0 0)' : 'rgb(255 255 255)';
}

function CommandBrandFallback({
  command,
  className,
}: {
  command?: BrandedCommand;
  className?: string;
}): React.ReactNode {
  if (command?.brandColor) {
    return (
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center rounded-xs font-medium text-2xs uppercase',
          className,
        )}
        style={{
          backgroundColor: command.brandColor,
          color: brandInitialForeground(command.brandColor),
        }}
      >
        {(command.displayName ?? command.name).slice(0, 1)}
      </span>
    );
  }
  return <BookTextIcon aria-hidden className={cn('shrink-0 opacity-80', className)} />;
}

function CommandBrandImage({
  command,
  className,
}: {
  command: BrandedCommand & { iconDataUri: string };
  className?: string;
}): React.ReactNode {
  const [failed, setFailed] = useState(false);
  if (failed) return <CommandBrandFallback command={command} className={className} />;
  return (
    <img
      alt=""
      className={cn('shrink-0 rounded-xs', className)}
      onError={() => setFailed(true)}
      src={command.iconDataUri}
    />
  );
}

/** A provider-branded command's glyph: its own icon, else a brandColor-tinted initial chip, else
 * the shared book glyph. One shape for menu rows, directive chips, and transcript echoes. */
export function CommandBrandGlyph({
  command,
  className,
}: {
  command?: BrandedCommand;
  className?: string;
}): React.ReactNode {
  if (command?.iconDataUri) {
    return (
      <CommandBrandImage
        key={command.iconDataUri}
        command={{ ...command, iconDataUri: command.iconDataUri }}
        className={className}
      />
    );
  }
  return <CommandBrandFallback command={command} className={className} />;
}

/** Brand tint for a valid command chip, mirroring the Badge info scale: hue from the provider's
 * brandColor, text pulled toward the theme foreground so dark brand colors stay legible on dark
 * surfaces (and light ones on light). Inline style — the color only exists at runtime. */
export function commandBrandChipStyle(
  command: Pick<AgentCommand, 'brandColor'> | undefined,
): React.CSSProperties | undefined {
  if (!command?.brandColor) return undefined;
  return {
    backgroundColor: `color-mix(in srgb, ${command.brandColor} 12%, transparent)`,
    color: `color-mix(in srgb, var(--foreground) 25%, ${command.brandColor})`,
  };
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

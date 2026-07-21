import { Card } from 'coss-ui/components/card';
import { cn } from '../lib/cn';

/** Large page-level heading at the top of a settings panel column (Codex-style). */
export function SettingsPageTitle({ children }: React.PropsWithChildren): React.ReactNode {
  return <h1 className="mb-8 font-semibold text-3xl tracking-tight">{children}</h1>;
}

/** A titled settings section: small heading floating above its content (Codex-style). */
export function SettingsSection({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="px-1 font-medium text-sm">{title}</h3>
      {children}
    </section>
  );
}

/** Card container that stacks {@link SettingsRow} children with hairline dividers. */
export function SettingsCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactNode {
  return <Card className={cn('divide-y divide-border', className)}>{children}</Card>;
}

/** One settings row: title + description on the left, the control on the right. */
export function SettingsRow({
  title,
  description,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium text-sm">{title}</span>
        {description === undefined ? null : (
          <span className="text-muted-foreground text-xs">{description}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

import { cn } from '../lib/cn';
import type { FileIconComponent } from '../lib/file-icon';
import { fileIconFor } from '../lib/file-icon';

function FileIcon({ icon: Icon }: { icon: FileIconComponent }): React.ReactNode {
  return <Icon className="size-full" />;
}

/** File-format identity shared by chat file surfaces. Material icons retain their own colors. */
export function FileIdentityIcon({
  className,
  path,
  ref,
}: {
  className?: string;
  path: string;
  ref?: React.Ref<HTMLSpanElement>;
}): React.ReactNode {
  return (
    <span aria-hidden className={cn('inline-flex size-3.5 shrink-0', className)} ref={ref}>
      <FileIcon icon={fileIconFor({ name: path })} />
    </span>
  );
}

import { Badge } from 'coss-ui/components/badge';
import { Card } from 'coss-ui/components/card';
import { ArrowRightIcon, MinusIcon, PackageIcon, PlusIcon } from 'lucide-react';
import { cn } from '../lib/cn';

// TODO(linkcode-schema): Provisional UI-only package metadata, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when package manager tool outputs expose structured package data.
export interface ChatPackageInfo {
  id: string;
  name: string;
  currentVersion?: string;
  newVersion?: string;
  changeType?: 'major' | 'minor' | 'patch' | 'added' | 'removed';
  description?: string;
  dependencies?: ChatPackageDependency[];
}

export interface ChatPackageDependency {
  id: string;
  name: string;
  version?: string;
}

export type PackageInfoProps = React.ComponentProps<'div'> & {
  packageInfo: ChatPackageInfo;
};

export function PackageInfo({
  className,
  packageInfo,
  children,
  ...props
}: PackageInfoProps): React.ReactNode {
  return (
    <Card className={cn('my-2 p-3 text-sm', className)} {...props}>
      {children ?? (
        <>
          <PackageInfoHeader packageInfo={packageInfo} />
          {packageInfo.description ? (
            <PackageInfoDescription>{packageInfo.description}</PackageInfoDescription>
          ) : null}
          {packageInfo.dependencies?.length ? (
            <PackageInfoDependencies dependencies={packageInfo.dependencies} />
          ) : null}
        </>
      )}
    </Card>
  );
}

export type PackageInfoHeaderProps = React.ComponentProps<'div'> & {
  packageInfo: ChatPackageInfo;
};

export function PackageInfoHeader({
  className,
  packageInfo,
  children,
  ...props
}: PackageInfoHeaderProps): React.ReactNode {
  return (
    <div className={cn('flex min-w-0 items-start justify-between gap-2', className)} {...props}>
      {children ?? (
        <>
          <div className="min-w-0">
            <PackageInfoName>{packageInfo.name}</PackageInfoName>
            <PackageInfoVersion packageInfo={packageInfo} />
          </div>
          {packageInfo.changeType ? (
            <PackageInfoChangeType changeType={packageInfo.changeType} />
          ) : null}
        </>
      )}
    </div>
  );
}

export type PackageInfoNameProps = React.ComponentProps<'div'>;

export function PackageInfoName({
  className,
  children,
  ...props
}: PackageInfoNameProps): React.ReactNode {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 font-mono font-medium text-foreground',
        className,
      )}
      {...props}
    >
      <PackageIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{children}</span>
    </div>
  );
}

export type PackageInfoVersionProps = React.ComponentProps<'div'> & {
  packageInfo: ChatPackageInfo;
};

export function PackageInfoVersion({
  className,
  packageInfo,
  children,
  ...props
}: PackageInfoVersionProps): React.ReactNode {
  if (!children && !packageInfo.currentVersion && !packageInfo.newVersion) return null;

  return (
    <div
      className={cn(
        'mt-1 flex min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          {packageInfo.currentVersion ? <span>{packageInfo.currentVersion}</span> : null}
          {packageInfo.currentVersion && packageInfo.newVersion ? (
            <ArrowRightIcon className="size-3" />
          ) : null}
          {packageInfo.newVersion ? (
            <span className="text-foreground">{packageInfo.newVersion}</span>
          ) : null}
        </>
      )}
    </div>
  );
}

export type PackageInfoChangeTypeProps = React.ComponentProps<typeof Badge> & {
  changeType: NonNullable<ChatPackageInfo['changeType']>;
};

export function PackageInfoChangeType({
  className,
  changeType,
  children,
  ...props
}: PackageInfoChangeTypeProps): React.ReactNode {
  const Icon =
    changeType === 'added' ? PlusIcon : changeType === 'removed' ? MinusIcon : ArrowRightIcon;

  return (
    <Badge
      className={cn('capitalize', className)}
      variant={packageChangeVariant(changeType)}
      {...props}
    >
      <Icon className="size-3" />
      {children ?? changeType}
    </Badge>
  );
}

export type PackageInfoDescriptionProps = React.ComponentProps<'p'>;

export function PackageInfoDescription({
  className,
  ...props
}: PackageInfoDescriptionProps): React.ReactNode {
  return <p className={cn('mt-2 text-muted-foreground', className)} {...props} />;
}

export type PackageInfoDependenciesProps = React.ComponentProps<'div'> & {
  dependencies: readonly ChatPackageDependency[];
};

export function PackageInfoDependencies({
  className,
  dependencies,
  children,
  ...props
}: PackageInfoDependenciesProps): React.ReactNode {
  return (
    <div className={cn('mt-3 border-t border-border pt-3', className)} {...props}>
      {children ?? (
        <>
          <div className="mb-2 text-xs uppercase text-muted-foreground">Dependencies</div>
          <div className="space-y-1">
            {dependencies.map((dependency) => (
              <PackageInfoDependency key={dependency.id} dependency={dependency} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export type PackageInfoDependencyProps = React.ComponentProps<'div'> & {
  dependency: ChatPackageDependency;
};

export function PackageInfoDependency({
  className,
  dependency,
  children,
  ...props
}: PackageInfoDependencyProps): React.ReactNode {
  return (
    <div
      className={cn('flex min-w-0 items-center justify-between gap-3 font-mono text-xs', className)}
      {...props}
    >
      {children ?? (
        <>
          <span className="min-w-0 truncate text-muted-foreground">{dependency.name}</span>
          {dependency.version ? (
            <span className="shrink-0 text-foreground">{dependency.version}</span>
          ) : null}
        </>
      )}
    </div>
  );
}

function packageChangeVariant(
  changeType: NonNullable<ChatPackageInfo['changeType']>,
): React.ComponentProps<typeof Badge>['variant'] {
  switch (changeType) {
    case 'added':
      return 'info';
    case 'removed':
    case 'major':
      return 'error';
    case 'minor':
      return 'warning';
    default:
      return 'success';
  }
}

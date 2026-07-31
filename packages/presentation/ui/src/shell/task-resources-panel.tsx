import { Button } from 'coss-ui/components/button';
import { Input } from 'coss-ui/components/input';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from 'coss-ui/components/menu';
import {
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PlusIcon,
  QuoteIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react';
import { useRef } from 'react';
import { useTranslations } from 'use-intl';
import { useRelativeTimeLabel } from './use-relative-time-label';

export type ResourceDirection = 'source' | 'output';
export type ResourceKind = 'file' | 'image' | 'document' | 'site' | 'link';
export type ResourceStatus = 'processing' | 'generating' | 'ready' | 'failed' | 'unavailable';
export type OutputResourceKind = Extract<ResourceKind, 'document' | 'site'>;

export interface ResourceItem {
  id: string;
  direction: ResourceDirection;
  name: string;
  kind: ResourceKind;
  status: ResourceStatus;
  source?: string;
  updatedAt?: number;
  error?: string;
  canOpen?: boolean;
  canDownload?: boolean;
}

export interface TaskResourcesPanelProps {
  resources: ResourceItem[];
  onAddSource?: (files: File[]) => void;
  onCreateOutput?: (kind: OutputResourceKind) => void;
  onOpen?: (resource: ResourceItem) => void;
  onDownload?: (resource: ResourceItem) => void;
  onReferenceOutput?: (resource: ResourceItem) => void;
  onRemove?: (resource: ResourceItem) => void;
  onRetry?: (resource: ResourceItem) => void;
  className?: string;
}

const KIND_ICONS: Record<ResourceKind, React.ReactNode> = {
  file: <FileIcon />,
  image: <ImageIcon />,
  document: <FileTextIcon />,
  site: <GlobeIcon />,
  link: <LinkIcon />,
};

export function TaskResourcesPanel({
  resources,
  onAddSource,
  onCreateOutput,
  onOpen,
  onDownload,
  onReferenceOutput,
  onRemove,
  onRetry,
  className,
}: TaskResourcesPanelProps): React.ReactNode {
  const sources = resources.filter((resource) => resource.direction === 'source');
  const outputs = resources.filter((resource) => resource.direction === 'output');

  return (
    <div className={`flex h-full min-h-0 flex-col overflow-y-auto ${className ?? ''}`}>
      <ResourceSection
        direction="source"
        resources={sources}
        onAddSource={onAddSource}
        onOpen={onOpen}
        onDownload={onDownload}
        onRemove={onRemove}
        onRetry={onRetry}
      />
      <ResourceSection
        direction="output"
        resources={outputs}
        onCreateOutput={onCreateOutput}
        onOpen={onOpen}
        onDownload={onDownload}
        onReferenceOutput={onReferenceOutput}
        onRemove={onRemove}
        onRetry={onRetry}
      />
    </div>
  );
}

function ResourceSection({
  direction,
  resources,
  onAddSource,
  onCreateOutput,
  ...actions
}: Omit<TaskResourcesPanelProps, 'resources'> & {
  direction: ResourceDirection;
  resources: ResourceItem[];
}): React.ReactNode {
  const t = useTranslations('workbench.resources');
  const inputRef = useRef<HTMLInputElement>(null);
  const retry =
    actions.onRetry ??
    (direction === 'source' && onAddSource ? () => inputRef.current?.click() : undefined);

  return (
    <section className="border-border border-b last:border-b-0">
      <div className="flex h-10 items-center px-3">
        <h2 className="font-medium text-sm">{t(direction === 'source' ? 'sources' : 'outputs')}</h2>
        <div className="ml-auto">
          {direction === 'source' && onAddSource && (
            <>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('addSource')}
                onClick={() => inputRef.current?.click()}
              >
                <PlusIcon />
              </Button>
              <Input
                ref={inputRef}
                nativeInput
                className="hidden"
                type="file"
                multiple
                aria-label={t('addSource')}
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  if (files.length > 0) onAddSource(files);
                  event.currentTarget.value = '';
                }}
              />
            </>
          )}
          {direction === 'output' && onCreateOutput && (
            <Menu>
              <MenuTrigger
                render={
                  <Button size="icon-sm" variant="ghost" aria-label={t('addOutput')}>
                    <PlusIcon />
                  </Button>
                }
              />
              <MenuPopup align="end">
                <MenuItem onClick={() => onCreateOutput('document')}>
                  <FileTextIcon />
                  {t('createDocument')}
                </MenuItem>
                <MenuItem onClick={() => onCreateOutput('site')}>
                  <GlobeIcon />
                  {t('createSite')}
                </MenuItem>
              </MenuPopup>
            </Menu>
          )}
        </div>
      </div>
      {resources.length === 0 ? (
        <p className="px-3 pb-4 text-label-tertiary text-xs">
          {t(direction === 'source' ? 'emptySources' : 'emptyOutputs')}
        </p>
      ) : (
        <div className="pb-1">
          {resources.map((resource) => (
            <ResourceRow key={resource.id} resource={resource} {...actions} onRetry={retry} />
          ))}
        </div>
      )}
    </section>
  );
}

function ResourceRow({
  resource,
  onOpen,
  onDownload,
  onReferenceOutput,
  onRemove,
  onRetry,
}: Pick<
  TaskResourcesPanelProps,
  'onOpen' | 'onDownload' | 'onReferenceOutput' | 'onRemove' | 'onRetry'
> & { resource: ResourceItem }): React.ReactNode {
  const t = useTranslations('workbench.resources');
  const updated = useRelativeTimeLabel(resource.updatedAt ?? 0);
  const hasMenu =
    (resource.canOpen && onOpen) ||
    (resource.canDownload && onDownload) ||
    (resource.direction === 'output' && onReferenceOutput) ||
    onRemove;

  return (
    <div className="group flex min-w-0 items-start gap-2 px-3 py-(--density-row-py) hover:bg-accent active:bg-accent">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">
        {KIND_ICONS[resource.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm">{resource.name}</span>
          <ResourceStatusIndicator status={resource.status} />
        </div>
        <p className="truncate text-label-tertiary text-xs">
          {resource.source ?? (resource.updatedAt === undefined ? t(resource.status) : updated)}
        </p>
        {(resource.status === 'failed' || resource.status === 'unavailable') && resource.error && (
          <p className="mt-0.5 text-destructive-foreground text-xs">{resource.error}</p>
        )}
        {resource.status === 'failed' && onRetry && (
          <Button className="mt-1" size="xs" variant="ghost" onClick={() => onRetry(resource)}>
            <RefreshCwIcon />
            {t('retry')}
          </Button>
        )}
      </div>
      {hasMenu && (
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('actions', { name: resource.name })}
              >
                <MoreHorizontalIcon />
              </Button>
            }
          />
          <MenuPopup align="end">
            {resource.canOpen && onOpen && (
              <MenuItem onClick={() => onOpen(resource)}>
                <ExternalLinkIcon />
                {t('open')}
              </MenuItem>
            )}
            {resource.canDownload && onDownload && (
              <MenuItem onClick={() => onDownload(resource)}>
                <DownloadIcon />
                {t('download')}
              </MenuItem>
            )}
            {resource.direction === 'output' && onReferenceOutput && (
              <MenuItem onClick={() => onReferenceOutput(resource)}>
                <QuoteIcon />
                {t('reference')}
              </MenuItem>
            )}
            {onRemove && (
              <MenuItem variant="destructive" onClick={() => onRemove(resource)}>
                <Trash2Icon />
                {t('remove')}
              </MenuItem>
            )}
          </MenuPopup>
        </Menu>
      )}
    </div>
  );
}

function ResourceStatusIndicator({ status }: { status: ResourceStatus }): React.ReactNode {
  const t = useTranslations('workbench.resources');
  if (status === 'processing' || status === 'generating') {
    return (
      <LoaderCircleIcon
        aria-label={t(status)}
        className="size-3.5 shrink-0 animate-spin text-label-tertiary"
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={t(status)}
      className={`size-1.5 shrink-0 rounded-full ${
        status === 'ready'
          ? 'bg-success'
          : status === 'unavailable'
            ? 'bg-label-tertiary'
            : 'bg-destructive'
      }`}
    />
  );
}

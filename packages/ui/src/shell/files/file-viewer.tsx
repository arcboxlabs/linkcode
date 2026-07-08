import type { WorkspaceFile } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useTranslations } from 'use-intl';
import { artifactKindForPath } from '../../chat/artifacts';
import { Markdown } from '../../chat/markdown';
import { cn } from '../../lib/cn';

export interface FileViewerProps {
  /** The tab's path — drives the viewer choice even while content loads. */
  path: string;
  file: WorkspaceFile | undefined;
  isLoading: boolean;
  error?: unknown;
  className?: string;
}

function dataUrl(file: WorkspaceFile): string {
  const mime = file.mimeType ?? 'application/octet-stream';
  if (file.encoding === 'base64') return `data:${mime};base64,${file.content}`;
  return `data:${mime};utf8,${encodeURIComponent(file.content)}`;
}

/** Renders one workspace file by artifact kind: markdown through the chat pipeline,
 * images/PDF natively, utf8 text as-is; anything else degrades to a notice. */
export function FileViewer({
  path,
  file,
  isLoading,
  error,
  className,
}: FileViewerProps): React.ReactNode {
  const t = useTranslations('workbench.files');

  if (error !== undefined && error !== null && !file) {
    return (
      <FileViewerNotice
        className={className}
        title={t('loadFailed')}
        detail={extractErrorMessage(error) ?? undefined}
      >
        {path}
      </FileViewerNotice>
    );
  }
  if (!file) {
    return (
      <div className={cn('h-full animate-pulse p-4 text-muted-foreground text-sm', className)}>
        {isLoading ? null : path}
      </div>
    );
  }

  const kind = artifactKindForPath(file.path) ?? (file.encoding === 'utf8' ? 'text' : null);

  switch (kind) {
    case 'markdown':
      return (
        <div className={cn('h-full overflow-y-auto px-6 py-5', className)}>
          <Markdown className="mx-auto max-w-3xl">{file.content}</Markdown>
        </div>
      );
    case 'image':
      return (
        <div className={cn('flex h-full items-center justify-center overflow-auto p-4', className)}>
          <img
            src={dataUrl(file)}
            alt={file.path}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        </div>
      );
    case 'pdf':
      return <PdfView file={file} className={className} />;
    case 'text':
      return (
        <pre
          className={cn(
            'h-full overflow-auto p-4 font-mono text-[12.5px] leading-relaxed',
            className,
          )}
        >
          {file.content}
        </pre>
      );
    default:
      return (
        <FileViewerNotice className={className} title={t('unsupported')}>
          {file.path}
        </FileViewerNotice>
      );
  }
}

/** Blob URLs keyed by the SWR-cached file object: idempotent per file (safe to call in
 * render), alive exactly as long as the cache holds the file, revoked when it's GC'd. */
const pdfBlobUrls = new WeakMap<WorkspaceFile, string>();
const pdfBlobReclaim = new FinalizationRegistry<string>((url) => URL.revokeObjectURL(url));

function pdfBlobUrlFor(file: WorkspaceFile): string {
  const cached = pdfBlobUrls.get(file);
  if (cached !== undefined) return cached;
  const bytes = Uint8Array.from(atob(file.content), (char) => char.codePointAt(0)!);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  pdfBlobUrls.set(file, url);
  pdfBlobReclaim.register(file, url);
  return url;
}

/** Chromium's built-in PDF viewer refuses `data:` documents (and in Electron only
 * loads via frame navigation, not <object>/<embed>), so the base64 payload becomes a
 * blob URL in an iframe. */
function PdfView({
  file,
  className,
}: {
  file: WorkspaceFile;
  className?: string;
}): React.ReactNode {
  return (
    // eslint-disable-next-line @eslint-react/dom-no-missing-iframe-sandbox -- a sandboxed frame blocks the PDF plugin; the source is an app-constructed application/pdf blob
    <iframe
      src={pdfBlobUrlFor(file)}
      title={file.path}
      className={cn('h-full w-full border-0', className)}
    />
  );
}

function FileViewerNotice({
  title,
  detail,
  children,
  className,
}: {
  title: string;
  /** The underlying failure reason (daemon error message), shown under the path. */
  detail?: string;
  children?: React.ReactNode;
  className?: string;
}): React.ReactNode {
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center gap-1 p-6 text-center',
        className,
      )}
    >
      <div className="font-medium text-foreground text-sm">{title}</div>
      {children ? (
        <div className="max-w-full truncate font-mono text-muted-foreground text-xs">
          {children}
        </div>
      ) : null}
      {detail ? (
        <div className="max-w-full truncate text-muted-foreground/80 text-xs">{detail}</div>
      ) : null}
    </div>
  );
}

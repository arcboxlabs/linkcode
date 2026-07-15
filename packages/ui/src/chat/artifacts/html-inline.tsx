import { Button } from 'coss-ui/components/button';
import { AppWindowIcon, PlayIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { ArtifactFrame } from './artifact-frame';
import { FenceFallback } from './fence-fallback';
import { useArtifactHostActions } from './host-actions';
import type { InlineArtifactProps } from './types';

const HTML_MIME = 'text/html; charset=utf-8';

/**
 * Sandboxed html artifact (CODE-62): the fence shows as code until the user expands
 * it; expanding uploads the document to the daemon's ephemeral hosting and renders it
 * in an iframe on its own `artifact--<hash>.localhost` origin. The sandbox stays tight
 * (scripts only — no same-origin, no forms/popups); the dedicated origin isolates it
 * from other artifacts and the daemon even without the attribute.
 */
export function HtmlInline({ artifact, isIncomplete }: InlineArtifactProps): React.ReactNode {
  const t = useTranslations('workbench.artifact');
  const actions = useArtifactHostActions();
  const [preview, setPreview] = useState<{ forCode: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const code = artifact.source.text;
  const hostArtifact = actions?.hostArtifact;

  // No hosting support (or still streaming): plain code block, optionally with the
  // expand affordance once the fence closes.
  if (!hostArtifact || isIncomplete) {
    return <FenceFallback code={code} language="html" />;
  }

  const activeUrl = preview?.forCode === code ? preview.url : null;

  function expand(): void {
    setError(null);
    hostArtifact!(code, HTML_MIME)
      .then(({ url }) => setPreview({ forCode: code, url }))
      .catch(() => setError(t('hostFailed')));
  }

  if (activeUrl === null) {
    return (
      <div className="relative">
        <FenceFallback code={code} language="html" note={error ?? undefined} />
        <div className="-mt-1 mb-2 flex justify-end">
          <Button size="xs" variant="outline" className="gap-1.5" onClick={expand}>
            <PlayIcon className="size-3.5" />
            {t('expandPreview')}
          </Button>
        </div>
      </div>
    );
  }

  const openPreview = (): void => {
    if (actions.openPreviewUrl) actions.openPreviewUrl(activeUrl);
    else window.open(activeUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <ArtifactFrame kindLabel="html" code={code} isIncomplete={false}>
      <iframe
        src={activeUrl}
        title={artifact.title ?? 'html artifact'}
        sandbox="allow-scripts"
        className="h-96 w-full border-0 bg-white"
      />
      <div className="flex justify-end border-border border-t px-2 py-1.5">
        <Button size="xs" variant="ghost" className="gap-1.5" onClick={openPreview}>
          <AppWindowIcon className="size-3.5" />
          {t('openInPanel')}
        </Button>
      </div>
    </ArtifactFrame>
  );
}

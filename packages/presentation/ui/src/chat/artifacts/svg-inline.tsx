import dompurify from 'dompurify';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { ArtifactFrame } from './artifact-frame';
import { extractSvgLabel } from './element-label';
import { FenceFallback } from './fence-fallback';
import { useArtifactHostActions } from './host-actions';
import type { InlineArtifactProps } from './types';

const SVG_ROOT_RE = /<svg[\s>]/i;

function sanitizeSvg(source: string): string | null {
  const clean = dompurify.sanitize(source, { USE_PROFILES: { svg: true, svgFilters: true } });
  // A fence labeled `svg` that sanitizes down to no <svg> root was not actually svg.
  return SVG_ROOT_RE.test(clean) ? clean : null;
}

export function SvgInline({ artifact, isIncomplete }: InlineArtifactProps): React.ReactNode {
  const t = useTranslations('workbench.artifact');
  const actions = useArtifactHostActions();
  const code = artifact.source.text.trim();

  // Unlike mermaid there is no cheap validity check for a partial document, so the
  // image only renders once the fence closes; streaming shows a placeholder.
  const clean = !isIncomplete && code ? sanitizeSvg(code) : null;

  if (!isIncomplete && clean === null) {
    return <FenceFallback code={code} language="svg" note={t('renderFailed')} />;
  }

  function onClick(event: React.MouseEvent<HTMLDivElement>): void {
    if (!actions) return;
    const label = extractSvgLabel(event.target as Element, event.currentTarget);
    if (label) actions.referenceToComposer(`\`${label}\``);
  }

  return (
    <ArtifactFrame kindLabel="svg" code={code} isIncomplete={isIncomplete}>
      {clean ? (
        <div
          className={cn(
            'flex justify-center overflow-x-auto p-3 [&_svg]:h-auto [&_svg]:max-w-full',
            actions && 'cursor-pointer',
          )}
          title={actions ? t('clickToReference') : undefined}
          onClick={onClick}
          // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml -- DOMPurify svg profile output (scripts, event handlers, foreign elements stripped)
          dangerouslySetInnerHTML={{ __html: clean }}
        />
      ) : (
        <div className="flex h-24 animate-pulse items-center justify-center text-muted-foreground text-sm">
          {t('streaming')}
        </div>
      )}
    </ArtifactFrame>
  );
}

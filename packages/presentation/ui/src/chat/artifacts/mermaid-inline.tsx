import { useEffect } from 'foxact/use-abortable-effect';
import { useId, useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { ArtifactFrame } from './artifact-frame';
import { extractMermaidLabel } from './element-label';
import { FenceFallback } from './fence-fallback';
import { useArtifactHostActions } from './host-actions';
import type { InlineArtifactProps } from './types';

interface RenderedDiagram {
  code: string;
  svg: string;
}

const NON_WORD_RE = /\W/g;

export function MermaidInline({ artifact, isIncomplete }: InlineArtifactProps): React.ReactNode {
  const t = useTranslations('workbench.artifact');
  const actions = useArtifactHostActions();
  const reactId = useId();
  // Streaming yields mostly-invalid intermediates: the last good diagram stays up while newer
  // chunks fail to parse; only a failure of the *final* source degrades to the code block.
  const [lastGood, setLastGood] = useState<RenderedDiagram | null>(null);
  const [failedCode, setFailedCode] = useState<string | null>(null);
  const code = artifact.source.text.trim();

  useEffect(
    (signal) => {
      if (!code) return;
      void (async () => {
        // mermaid is ~1.5 MB — load it only when a diagram actually renders.
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'neutral',
        });
        try {
          // parse() rejects invalid sources without touching the DOM; render() would
          // leave error artifacts behind.
          await mermaid.parse(code);
          const { svg } = await mermaid.render(`mmd${reactId.replaceAll(NON_WORD_RE, '')}`, code);
          if (!signal.aborted) setLastGood({ code, svg });
        } catch {
          if (!signal.aborted) setFailedCode(code);
        }
      })();
    },
    [code, reactId],
  );

  if (!isIncomplete && failedCode === code && lastGood?.code !== code) {
    return <FenceFallback code={code} language="mermaid" note={t('renderFailed')} />;
  }

  function onClick(event: React.MouseEvent<HTMLDivElement>): void {
    if (!actions) return;
    const label = extractMermaidLabel(event.target as Element, event.currentTarget);
    if (label) actions.referenceToComposer(`\`${label}\``);
  }

  return (
    <ArtifactFrame kindLabel="mermaid" code={code} isIncomplete={isIncomplete}>
      {lastGood ? (
        <div
          className={cn(
            'flex justify-center overflow-x-auto p-3 [&_svg]:h-auto [&_svg]:max-w-full',
            actions &&
              '[&_g.actor]:cursor-pointer [&_g.cluster]:cursor-pointer [&_g.edgeLabel]:cursor-pointer [&_g.node]:cursor-pointer',
          )}
          title={actions ? t('clickToReference') : undefined}
          onClick={onClick}
          // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml -- mermaid output with securityLevel: 'strict' (labels escaped, no foreign HTML)
          dangerouslySetInnerHTML={{ __html: lastGood.svg }}
        />
      ) : (
        <div className="flex h-24 animate-pulse items-center justify-center text-muted-foreground text-sm">
          {t('streaming')}
        </div>
      )}
    </ArtifactFrame>
  );
}

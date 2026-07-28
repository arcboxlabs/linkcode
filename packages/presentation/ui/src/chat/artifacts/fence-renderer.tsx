import { Component } from 'react';
import type { CustomRendererProps } from 'streamdown';
import { useTranslations } from 'use-intl';
import { FenceFallback } from './fence-fallback';
import { resolveFencedArtifact } from './registry';

interface BoundaryProps {
  /** A new source retries rendering after an error (streaming appends fix syntax). */
  resetKey: string;
  fallback: React.ReactNode;
  children: React.ReactNode;
}

/** Inline renderers own their async failures; this catches synchronous render crashes
 * so a broken artifact never takes the whole conversation down. */
class ArtifactErrorBoundary extends Component<BoundaryProps, { errorKey: string | null }> {
  override state: { errorKey: string | null } = { errorKey: null };

  override componentDidCatch(): void {
    this.setState({ errorKey: this.props.resetKey });
  }

  override render(): React.ReactNode {
    if (this.state.errorKey !== null && this.state.errorKey === this.props.resetKey) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/** Renders every Markdown fence: detect an artifact kind → render it inline, degrading
 * to the coss-ui code block (FenceFallback) for plain code and failures. */
export function ArtifactFenceRenderer({
  code,
  language,
  meta,
  isIncomplete,
}: CustomRendererProps): React.ReactNode {
  const t = useTranslations('workbench.artifact');
  const resolved = resolveFencedArtifact({ language, code, meta, isIncomplete });

  if (!resolved) {
    return <FenceFallback code={code} language={language} />;
  }

  const { artifact, definition } = resolved;
  const Inline = definition.Inline!;
  return (
    <ArtifactErrorBoundary
      resetKey={code}
      fallback={<FenceFallback code={code} language={language} note={t('renderFailed')} />}
    >
      <Inline artifact={artifact} isIncomplete={isIncomplete} />
    </ArtifactErrorBoundary>
  );
}

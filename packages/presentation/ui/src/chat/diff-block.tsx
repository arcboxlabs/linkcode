import type { FileDiffMetadata, FileDiffOptions } from '@pierre/diffs';
import { parseDiffFromFile, processFile } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { cn } from '../lib/cn';
import type { ArtifactNavigation } from './artifacts/host-actions';
import type { DiffStats, DiffToolCallContent } from './diff-utils';
import { diffContentStats } from './diff-utils';
import { FilePreviewCard } from './file-preview-card';

export function DiffCounter({
  className,
  stats,
}: {
  className?: string;
  stats: DiffStats;
}): React.ReactNode {
  if (stats.additions + stats.deletions === 0) return null;

  return (
    <span className={cn('flex shrink-0 items-center gap-1 font-mono text-xs', className)}>
      <span className="text-success-foreground">+{stats.additions}</span>
      <span className="text-destructive-foreground">-{stats.deletions}</span>
    </span>
  );
}

const CHAT_DIFF_OPTIONS: FileDiffOptions<undefined> = {
  // The card is one narrow column inside the chat flow, so `split` (the library default) is
  // unreadable here. `wrap` keeps the card to a single scroll axis — a nested horizontal scroller
  // would fight the disclosure's ScrollArea and the virtualized timeline outside it.
  diffStyle: 'unified',
  overflow: 'wrap',
  // FilePreviewCard already renders the file identity, path tooltip, and open action.
  disableFileHeader: true,
  // Renders the raw `@@ -120,8 +120,9 @@` range. The default `line-info` separator hardcodes
  // English ("N unmodified lines", "Expand all") with an en-US plural rule, which cannot go through
  // use-intl; its expand affordance is dead here anyway, since patch-derived diffs carry no file
  // body to expand into.
  hunkSeparators: 'metadata',
};

/** A hunk stream with no `---`/`+++` (or `diff --git`) preamble. Both producers emit one: codex
 * forwards its app-server `unified_diff` verbatim, and the claude adapter formats
 * `structuredPatch` hunks. Pierre parses zero hunks out of that, so the card would render blank. */
const HEADERLESS_PATCH = /^\s*@@/;

/** Pierre only strips the `a/`…`b/` prefixes when a `diff --git` line proves it is a git patch, so
 * the synthesized header uses the bare path on both sides — otherwise the two names differ and the
 * diff is misread as a rename. */
function patchWithHeader(text: string, path: string): string {
  return HEADERLESS_PATCH.test(text) ? `--- ${path}\n+++ ${path}\n${text}` : text;
}

// Parsing runs jsdiff (or pierre's patch parser) and is far too heavy for a render pass. The
// conversation builder replaces content objects rather than mutating them, so object identity is a
// sound cache key — the same trick `diffContentStats` uses.
const fileDiffCache = new WeakMap<DiffToolCallContent, FileDiffMetadata | null>();

/** Build the renderable diff for one `type: 'diff'` content item, or null when there is nothing to
 * draw (binary, or a rename/delete carrying neither a patch nor text). */
export function chatFileDiff(content: DiffToolCallContent): FileDiffMetadata | null {
  const cached = fileDiffCache.get(content);
  if (cached !== undefined) return cached;
  const built = buildFileDiff(content);
  fileDiffCache.set(content, built);
  return built;
}

function buildFileDiff(content: DiffToolCallContent): FileDiffMetadata | null {
  const { path, oldPath, oldText, newText, patch, isBinary } = content;
  if (isBinary) return null;
  if (patch?.text) {
    const parsed = processFile(patchWithHeader(patch.text, path));
    // A patch that yields no hunks is not authoritative; codex ships hunk text alongside it.
    if (parsed && parsed.hunks.length > 0) return parsed;
  }
  if (oldText === undefined && newText === undefined) return null;
  // Infinite context: `oldText`/`newText` are the replaced region, not the file, so any finite
  // window would drop rows the payload already carries and fence a snippet with `@@` ranges whose
  // line numbers mean nothing. Pierre infers new/deleted/renamed from the contents and names.
  const parsed = parseDiffFromFile(
    { name: oldPath ?? path, contents: oldText ?? '' },
    { name: path, contents: newText ?? '' },
    { context: Number.MAX_SAFE_INTEGER },
  );
  return parsed.hunks.length > 0 ? parsed : null;
}

export function DiffBlock({
  content,
  navigation,
}: {
  content: DiffToolCallContent;
  navigation?: ArtifactNavigation | null;
}): React.ReactNode {
  const fileDiff = chatFileDiff(content);
  const { path, oldPath } = content;
  // `overflow-hidden`: the panel is rounded, but pierre's rows are square and full-bleed, so they
  // need a clip to stay inside its corners.
  return (
    <FilePreviewCard
      headerEnd={<DiffCounter className="ml-auto gap-1.5" stats={diffContentStats(content)} />}
      label={oldPath ? `${oldPath} → ${path}` : undefined}
      navigation={navigation}
      panelClassName={fileDiff ? 'chat-diff-surface overflow-hidden p-0' : undefined}
      path={path}
    >
      {fileDiff ? <FileDiff fileDiff={fileDiff} options={CHAT_DIFF_OPTIONS} /> : undefined}
    </FilePreviewCard>
  );
}

import { suggestWorkspaceFiles } from '@linkcode/sdk';
import type { MentionItem } from '@linkcode/ui';
import { useDebouncedValue } from 'foxact/use-debounced-value';
import { useMemo, useState } from 'react';
import { useData } from '../runtime/tayori';

const MENTION_QUERY_DEBOUNCE_MS = 180;
const MENTION_SUGGEST_LIMIT = 50;

export interface FileMentionSource {
  /** Ranked workspace files for the current `@` query, mapped for the composer's menu. */
  mentionItems: MentionItem[];
  /** Feed a composer's workspace and live `@` query here (null = no active mention trigger). */
  onMentionQueryChange: (cwd: string | undefined, query: string | null) => void;
}

/** The live `@` query plus its open-trigger generation. The generation bumps on every trigger
 * open, so a trailing debounced value can be told apart from a previous trigger's — the debounce
 * itself never resets. `openingQuery` is what the trigger opened with: the one value worth
 * fetching before the debounce first catches up, stable across a typing burst. */
interface MentionQuery {
  cwd: string | undefined;
  query: string | null;
  openingQuery: string | null;
  generation: number;
}

const NO_MENTION_QUERY: MentionQuery = {
  cwd: undefined,
  query: null,
  openingQuery: null,
  generation: 0,
};

/**
 * Backs composers' `@` menus with `file.suggest` daemon searches. Each query carries its own cwd,
 * so one source can serve either a live session or a new-session draft without retaining results
 * from the previously active workspace.
 */
export function useFileMentionSource(): FileMentionSource {
  const [live, setLive] = useState<MentionQuery>(NO_MENTION_QUERY);
  const debounced = useDebouncedValue(live, MENTION_QUERY_DEBOUNCE_MS);
  // Until the debounce catches up with THIS trigger (generation mismatch = the trailing value is
  // a previous trigger's), fetch the opening query; once caught up, the debounced one takes over.
  const effectiveQuery =
    live.cwd === undefined || live.query === null
      ? null
      : debounced.generation === live.generation
        ? (debounced.query ?? live.query)
        : (live.openingQuery ?? live.query);

  const onMentionQueryChange = (cwd: string | undefined, query: string | null): void => {
    setLive((prev) => {
      if (query === null) {
        return prev.query === null ? prev : { ...prev, query: null };
      }
      return prev.query === null || prev.cwd !== cwd
        ? { cwd, query, openingQuery: query, generation: prev.generation + 1 }
        : { ...prev, query };
    });
  };

  const { data } = useData(
    suggestWorkspaceFiles,
    live.cwd === undefined || effectiveQuery === null
      ? null
      : { cwd: live.cwd, query: effectiveQuery, limit: MENTION_SUGGEST_LIMIT },
    {
      // A suggestion belongs to its request cwd. Global keepPreviousData would briefly expose the
      // previous workspace's paths after a draft/session switch, where they could be inserted.
      keepPreviousData: false,
    },
  );

  const mentionItems = useMemo<MentionItem[]>(
    () =>
      effectiveQuery === null
        ? []
        : (data ?? []).map((suggestion) => {
            const separator = suggestion.path.lastIndexOf('/');
            return {
              id: suggestion.path,
              value: suggestion.path,
              label: separator === -1 ? suggestion.path : suggestion.path.slice(separator + 1),
              hint: separator === -1 ? undefined : suggestion.path.slice(0, separator),
            };
          }),
    [data, effectiveQuery],
  );

  return { mentionItems, onMentionQueryChange };
}

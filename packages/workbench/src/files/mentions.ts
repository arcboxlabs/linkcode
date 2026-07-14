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
  /** Feed the composer's live `@` query in here (null = no active mention trigger). */
  onMentionQueryChange: (query: string | null) => void;
}

/** The live `@` query plus which open-trigger it belongs to. The generation bumps every time a
 * trigger opens (null → string), so a trailing debounced value is recognizable as belonging to
 * the current trigger or to a previous one — `useDebouncedValue` itself never resets, and right
 * after a reopen it still holds the previous trigger's settled query for up to the debounce
 * window. `openingQuery` is the query the trigger opened with: the one value worth fetching
 * before the debounce first catches up, stable across a typing burst. */
interface MentionQuery {
  query: string | null;
  openingQuery: string | null;
  generation: number;
}

const NO_MENTION_QUERY: MentionQuery = { query: null, openingQuery: null, generation: 0 };

/**
 * Backs the composer's `@` menu with `file.suggest` daemon searches for the active
 * session's workspace. Queries are debounced; the previous result stays visible while a
 * new one loads (stale-but-visible) so the menu never flashes empty between keystrokes.
 */
export function useFileMentionSource(cwd: string | undefined): FileMentionSource {
  const [live, setLive] = useState<MentionQuery>(NO_MENTION_QUERY);
  const debounced = useDebouncedValue(live, MENTION_QUERY_DEBOUNCE_MS);
  // Until the debounce first catches up with THIS trigger (generation mismatch: the trailing
  // value still belongs to a previous one), fetch the query the trigger opened with — immediate
  // first render, one stable key across the opening burst, and never a stale previous-trigger
  // query. Once caught up, the trailing debounced query takes over; the composer's client-side
  // substring re-filter keeps the menu responsive between fetches either way.
  const effectiveQuery =
    live.query === null
      ? null
      : debounced.generation === live.generation
        ? (debounced.query ?? live.query)
        : (live.openingQuery ?? live.query);

  const onMentionQueryChange = (query: string | null): void => {
    setLive((prev) => {
      if (query === null) {
        return prev.query === null ? prev : { ...prev, query: null };
      }
      return prev.query === null
        ? { query, openingQuery: query, generation: prev.generation + 1 }
        : { ...prev, query };
    });
  };

  const { data } = useData(
    suggestWorkspaceFiles,
    cwd === undefined || effectiveQuery === null
      ? null
      : { cwd, query: effectiveQuery, limit: MENTION_SUGGEST_LIMIT },
    { keepPreviousData: true },
  );

  const mentionItems = useMemo<MentionItem[]>(
    () =>
      (data ?? []).map((suggestion) => {
        const separator = suggestion.path.lastIndexOf('/');
        return {
          id: suggestion.path,
          value: suggestion.path,
          label: separator === -1 ? suggestion.path : suggestion.path.slice(separator + 1),
          hint: separator === -1 ? undefined : suggestion.path.slice(0, separator),
        };
      }),
    [data],
  );

  return { mentionItems, onMentionQueryChange };
}

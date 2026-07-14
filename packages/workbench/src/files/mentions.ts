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

/**
 * Backs the composer's `@` menu with `file.suggest` daemon searches for the active
 * session's workspace. Queries are debounced; the previous result stays visible while a
 * new one loads (stale-but-visible) so the menu never flashes empty between keystrokes.
 */
export function useFileMentionSource(cwd: string | undefined): FileMentionSource {
  const [query, setQuery] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, MENTION_QUERY_DEBOUNCE_MS);
  // While debounce lags a just-opened mention, fetch eagerly with the live value so the
  // first menu render isn't a guaranteed 180ms behind the trigger keystroke.
  const effectiveQuery = query === null ? null : (debouncedQuery ?? query);

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

  return { mentionItems, onMentionQueryChange: setQuery };
}

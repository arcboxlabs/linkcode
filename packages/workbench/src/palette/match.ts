import type { SessionInfo } from '@linkcode/schema';

/** A thread the palette can surface: the session plus its pre-resolved searchable strings. */
export interface PaletteThreadCandidate {
  session: SessionInfo;
  /** Resolved display title (session title or the agent-in-repo fallback); searchable. */
  title: string;
  /** Workspace display name shown as the row badge; searchable. `null` for chat/unregistered. */
  workspaceLabel: string | null;
}

/** A runnable palette entry. Apps register theirs via the palette store; workbench adds built-ins. */
export interface PaletteCommand {
  id: string;
  label: string;
  /** Platform-formatted display hint, e.g. `⌘,` — purely visual, no binding implied. */
  shortcut?: string;
  keywords?: readonly string[];
  run: () => void;
}

const THREAD_RESULT_LIMIT = 9;
const WHITESPACE_RUN = /\s+/g;

function normalize(value: string): string {
  return value.trim().replaceAll(WHITESPACE_RUN, ' ').toLowerCase();
}

function tokenize(normalizedQuery: string): string[] {
  return normalizedQuery.split(' ').filter(Boolean);
}

/**
 * Deterministic text score: exact > prefix > substring > all-tokens-present. No fuzzy matching —
 * CJK titles match predictably by substring, and ranking never depends on match heuristics.
 */
function scoreText(text: string, query: string, tokens: readonly string[]): number | null {
  if (text === query) return 100;
  if (text.startsWith(query)) return 80;
  if (text.includes(query)) return 60;
  if (tokens.length > 1 && tokens.every((token) => text.includes(token))) return 40;
  return null;
}

/**
 * Empty query: sessions awaiting input first, then most recently active, capped. With a query:
 * any title match outranks any workspace-label match; ties by recency, then shorter title, then
 * input order.
 */
export function matchPaletteThreads(
  candidates: readonly PaletteThreadCandidate[],
  query: string,
  limit: number = THREAD_RESULT_LIMIT,
): PaletteThreadCandidate[] {
  const normalizedQuery = normalize(query);

  if (!normalizedQuery) {
    return [...candidates]
      .sort(
        (a, b) =>
          awaitingBoost(b.session) - awaitingBoost(a.session) ||
          b.session.updatedAt - a.session.updatedAt,
      )
      .slice(0, limit);
  }

  const tokens = tokenize(normalizedQuery);
  return candidates
    .flatMap((candidate, index) => {
      const titleScore = scoreText(normalize(candidate.title), normalizedQuery, tokens);
      const workspaceScore =
        candidate.workspaceLabel === null
          ? null
          : scoreText(normalize(candidate.workspaceLabel), normalizedQuery, tokens);
      const score = titleScore === null ? workspaceScore : 1000 + titleScore;
      return score === null ? [] : [{ candidate, index, score }];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.candidate.session.updatedAt - a.candidate.session.updatedAt ||
        a.candidate.title.length - b.candidate.title.length ||
        a.index - b.index,
    )
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

function awaitingBoost(session: SessionInfo): number {
  return session.status === 'awaiting-input' ? 1 : 0;
}

/** Empty query: every command in registration order. With a query: label scoring, then keywords. */
export function matchPaletteCommands(
  commands: readonly PaletteCommand[],
  query: string,
): PaletteCommand[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [...commands];

  const tokens = tokenize(normalizedQuery);
  return commands
    .flatMap((command, index) => {
      const labelScore = scoreText(normalize(command.label), normalizedQuery, tokens);
      const keywordScore = command.keywords?.some((keyword) =>
        normalize(keyword).includes(normalizedQuery),
      )
        ? 30
        : null;
      const score = labelScore ?? keywordScore;
      return score === null ? [] : [{ command, index, score }];
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}

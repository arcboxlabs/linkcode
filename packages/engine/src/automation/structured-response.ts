import type { SessionId } from '@linkcode/schema';
import type { ZodType } from 'zod';
import type { SessionDriver } from './session-driver';

/** Matches a fenced code block; the opener's rest-of-line is skipped, the body captured. */
const RE_FENCED_JSON = /```[^\n]*\n([\s\S]*?)```/g;

/**
 * Coax a machine-readable value out of a free-form agent reply. Agents wrap JSON in prose, fence it,
 * or emit it bare; this walks candidates in order of confidence — fenced ```json blocks, then the
 * first balanced `{…}` object, then the whole trimmed text — and returns the first that `JSON.parse`s.
 * Returns `undefined` when nothing parses (distinct from a parsed `null`).
 */
export function extractJson(text: string): unknown {
  for (const candidate of jsonCandidates(text)) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Not valid JSON — fall through to the next, less confident, candidate.
    }
  }
  return undefined;
}

function* jsonCandidates(text: string): Generator<string> {
  // 1. Fenced code blocks (```json … ``` or a bare ``` … ```), most to least confident.
  for (const match of text.matchAll(RE_FENCED_JSON)) {
    const body = match[1].trim();
    if (body) yield body;
  }
  // 2. The first balanced object, tolerating prose on either side.
  const open = text.indexOf('{');
  if (open !== -1) {
    const object = balancedObjectFrom(text, open);
    if (object) yield object;
  }
  // 3. The whole reply (covers a reply that is already bare JSON).
  const trimmed = text.trim();
  if (trimmed) yield trimmed;
}

/** Return the substring from `open` through the matching `}`, respecting strings/escapes. */
function balancedObjectFrom(text: string, open: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    switch (ch) {
      case '"':
        inString = true;
        break;
      case '{':
        depth += 1;
        break;
      case '}':
        depth -= 1;
        if (depth === 0) return text.slice(open, i + 1);
        break;
      default:
        break;
    }
  }
  return undefined;
}

export interface StructuredPromptOptions {
  timeoutMs?: number;
  /** Corrective re-asks allowed after the first attempt (default 2 → up to 3 turns total). */
  maxRetries?: number;
}

/**
 * Prompt a session and parse its reply into `schema`, re-asking in the *same* session with the
 * validation error appended when the reply is unusable. Keeps the conversation context so the agent
 * can correct itself. Rejects once the retry budget is spent, or propagates a `driver.prompt` failure
 * (busy/timeout/permission stall) unchanged.
 */
export async function promptForStructured<T>(
  driver: Pick<SessionDriver, 'prompt'>,
  sessionId: SessionId,
  basePrompt: string,
  schema: ZodType<T>,
  opts: StructuredPromptOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  let prompt = basePrompt;
  let lastError = 'no reply';
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- retries are inherently sequential: each corrective re-ask depends on the previous reply.
    const { text } = await driver.prompt(sessionId, prompt, { timeoutMs: opts.timeoutMs });
    const json = extractJson(text);
    if (json === undefined) {
      lastError = 'no JSON object found in the reply';
    } else {
      const parsed = schema.safeParse(json);
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
    }
    prompt = `Your previous reply could not be used: ${lastError}. Reply with ONLY a single JSON object matching the required shape — no prose, no code fence.`;
  }
  throw new Error(
    `could not parse structured output after ${maxRetries + 1} attempts: ${lastError}`,
  );
}

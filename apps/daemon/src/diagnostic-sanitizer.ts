import { isErrorLikeObject } from 'foxts/extract-error-message';

const REDACTED = '[Redacted]';
const CIRCULAR = '[Circular]';
const SENSITIVE_KEY =
  /(?:api[-_]?keys?|auth[-_]?tokens?|access[-_]?tokens?|refresh[-_]?tokens?|id[-_]?tokens?|session[-_]?tokens?|client[-_]?secrets?|authorization|cookies?|passwords?|passphrases?|private[-_]?keys?|credentials?|secrets?|tokens?)$/i;
const CREDENTIAL_TEXT_PATTERNS = [
  /\b([\w-]*(?:api[-_]?keys?|auth[-_]?tokens?|access[-_]?tokens?|refresh[-_]?tokens?|id[-_]?tokens?|session[-_]?tokens?|client[-_]?secrets?|authorization|cookies?|passwords?|passphrases?|private[-_]?keys?|credentials?|secrets?|tokens?)\s*[:=]\s*)(?:(?:bearer|basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
  /\b((?:bearer|basic)\s+)[\w.~+/=-]+/gi,
  /\b(?:gh[opusr]_\w{20,}|sk-[\w-]{16,}|xox[baprs]-[\w-]{10,})\b/g,
] as const;

export function sanitizeDiagnosticText(text: string): string {
  return CREDENTIAL_TEXT_PATTERNS.reduce(
    (sanitized, pattern) =>
      sanitized.replace(pattern, (_match, prefix: string | undefined) =>
        typeof prefix === 'string' ? `${prefix}${REDACTED}` : REDACTED,
      ),
    text,
  );
}

export function sanitizeDiagnostic<T>(value: T): T;
export function sanitizeDiagnostic(value: unknown): unknown {
  return sanitizeValue(value, new WeakMap());
}

function sanitizeValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === 'string') return sanitizeDiagnosticText(value);
  if (typeof value !== 'object' || value === null) return value;

  if (seen.has(value)) return CIRCULAR;

  if (isErrorLikeObject(value)) {
    const sanitized: Record<string, unknown> = {
      type: value.name,
      message: sanitizeDiagnosticText(value.message),
      stack: value.stack === undefined ? undefined : sanitizeDiagnosticText(value.stack),
    };
    seen.set(value, sanitized);
    const cause = Reflect.get(value, 'cause');
    if (cause !== undefined) sanitized.cause = sanitizeValue(cause, seen);
    for (const [key, entry] of Object.entries(value)) {
      sanitized[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeValue(entry, seen);
    }
    return sanitized;
  }

  if (Array.isArray(value)) {
    const sanitized: unknown[] = [];
    seen.set(value, sanitized);
    for (const entry of value) sanitized.push(sanitizeValue(entry, seen));
    return sanitized;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  seen.set(value, sanitized);
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeValue(entry, seen);
  }
  return sanitized;
}

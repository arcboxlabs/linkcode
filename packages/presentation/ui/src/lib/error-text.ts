/** Matches one leading `Error: ` token (the `Error` name prefix added by error stringification). */
const ERROR_PREFIX = /^Error:\s+/;

/**
 * Collapse stacked `Error: Error: …` prefixes down to one. Wire error messages often already
 * carry the provider CLI's own `Error: ` prefix, and every client-side stringification pass
 * (e.g. `extractErrorMessage`'s name prefix) stacks another on top.
 */
export function normalizeErrorMessage(message: string): string {
  let rest = message;
  let prefixed = false;
  while (ERROR_PREFIX.test(rest)) {
    prefixed = true;
    rest = rest.replace(ERROR_PREFIX, '');
  }
  return prefixed ? `Error: ${rest}` : rest;
}

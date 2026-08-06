const PLACEHOLDER_PATTERN = /\{([a-z_]+)\}/g;

/** Account-specific `{placeholder}` fields a templated endpoint URL needs filled. */
export function templatePlaceholders(baseUrl: string): string[] {
  return [...baseUrl.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
}

export function fillTemplate(baseUrl: string, values: Record<string, string>): string {
  return baseUrl.replaceAll(PLACEHOLDER_PATTERN, (whole, key: string) => values[key] ?? whole);
}

/** Whether every `{placeholder}` was substituted. An unfilled one would silently request a literal
 * `{account_id}` URL, so callers refuse the binding instead. */
export function isTemplateFilled(baseUrl: string): boolean {
  return templatePlaceholders(baseUrl).length === 0;
}

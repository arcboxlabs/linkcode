/**
 * Structural equality over JSON-shaped values (the wire snapshots the engine caches). Key order
 * is insignificant — collectors assemble records from concurrently-resolving probes, so two equal
 * snapshots routinely differ in insertion order and a stringify comparison would false-diff.
 * An `undefined`-valued key equals an absent key, matching JSON serialization.
 */
export function jsonValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonValueEqual(item, b[index]));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  for (const key of Object.keys(left)) {
    if (!jsonValueEqual(left[key], right[key])) return false;
  }
  for (const key of Object.keys(right)) {
    if (!(key in left) && right[key] !== undefined) return false;
  }
  return true;
}

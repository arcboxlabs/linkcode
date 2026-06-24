export interface KeyedItem<T> {
  key: string;
  item: T;
}

export function keyedItems<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): Array<KeyedItem<T>> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const baseKey = keyOf(item);
    const count = seen.get(baseKey) ?? 0;
    seen.set(baseKey, count + 1);
    return { key: count === 0 ? baseKey : `${baseKey}:${count}`, item };
  });
}

export function stableContentKey(value: unknown): string {
  if (value === undefined) return hashString('undefined');
  if (typeof value === 'function') return hashString(`function:${value.name}`);
  if (typeof value === 'symbol') return hashString(`symbol:${String(value)}`);
  try {
    return hashString(JSON.stringify(value));
  } catch {
    return hashString(fallbackContentKey(value));
  }
}

function fallbackContentKey(value: unknown): string {
  switch (typeof value) {
    case 'bigint':
    case 'boolean':
    case 'number':
    case 'string':
      return `${typeof value}:${value.toString()}`;
    case 'object':
      return Object.prototype.toString.call(value);
    default:
      return typeof value;
  }
}

function hashString(value: string): string {
  let hash = 2_166_136_261;
  for (const char of value) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

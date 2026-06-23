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
  const json = JSON.stringify(value);
  return hashString(json === undefined ? typeof value : json);
}

function hashString(value: string): string {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

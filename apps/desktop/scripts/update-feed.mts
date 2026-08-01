import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { parse, stringify } from 'yaml';

interface UpdateFeed {
  files: unknown[];
  [key: string]: unknown;
}

function parseUpdateFeed(text: string): UpdateFeed {
  const value: unknown = parse(text);
  if (typeof value !== 'object' || value === null || !Array.isArray((value as UpdateFeed).files)) {
    throw new Error('electron-builder update feed has no files array');
  }
  return value as UpdateFeed;
}

export function mergeUpdateFeeds(first: string, second: string): string {
  const merged = parseUpdateFeed(first);
  appendArrayInPlace(merged.files, parseUpdateFeed(second).files);
  return stringify(merged);
}

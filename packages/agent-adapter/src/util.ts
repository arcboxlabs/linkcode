import type { ContentBlock, ToolKind } from '@linkcode/schema';

/** Flatten content blocks into a single prompt string (text blocks only). */
export function contentToText(content: ContentBlock[]): string {
  return content
    .reduce<string[]>((texts, c) => {
      if (c.type === 'text') texts.push(c.text);
      return texts;
    }, [])
    .join('\n');
}

/** Best-effort mapping of a tool name to an ACP ToolKind (drives UI iconography). */
export function toolKindFromName(name: string): ToolKind {
  const n = name.toLowerCase();
  if (/read|cat|view|open/.test(n)) return 'read';
  if (/write|edit|apply|patch|create|update/.test(n)) return 'edit';
  if (/delete|remove|\brm\b/.test(n)) return 'delete';
  if (/move|rename|\bmv\b/.test(n)) return 'move';
  if (/search|grep|glob|find/.test(n)) return 'search';
  if (/bash|exec|shell|\brun\b|command|terminal/.test(n)) return 'execute';
  if (/fetch|web|http|browser/.test(n)) return 'fetch';
  if (/think|plan|reason/.test(n)) return 'think';
  return 'other';
}

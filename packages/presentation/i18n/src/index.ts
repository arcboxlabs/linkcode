import { en } from './locales/en';
import { zhCN } from './locales/zh-cn';

export const locales = ['zh-CN', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'zh-CN';

export const messages = {
  'zh-CN': zhCN,
  en,
} as const;

export type Messages = (typeof messages)[Locale];

export function getMessages(locale: Locale): Messages {
  return messages[locale];
}

export function resolveLocale(input: string | readonly string[] | undefined): Locale {
  const candidates = typeof input === 'string' ? [input] : (input ?? []);
  for (const candidate of candidates) {
    const normalized = normalizeLocale(candidate);
    if (normalized) return normalized;
  }
  return defaultLocale;
}

function normalizeLocale(value: string): Locale | null {
  const lower = value.toLowerCase();
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN';
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  return null;
}

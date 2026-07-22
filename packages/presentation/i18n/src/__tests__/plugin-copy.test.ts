import { McpPluginDescriptionKeySchema, McpPluginLabelKeySchema } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { en } from '../locales/en';
import { zhCN } from '../locales/zh-cn';

function copyAt(messages: unknown, key: string): unknown {
  let value = property(messages, 'settings');
  value = property(value, 'plugins');
  for (const segment of key.split('.')) value = property(value, segment);
  return value;
}

function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

describe('plugin catalog copy', () => {
  it.each([
    ...McpPluginLabelKeySchema.options,
    ...McpPluginDescriptionKeySchema.options,
  ])('defines %s in every locale', (key) => {
    expect(copyAt(zhCN, key)).toBeTypeOf('string');
    expect(copyAt(en, key)).toBeTypeOf('string');
  });
});

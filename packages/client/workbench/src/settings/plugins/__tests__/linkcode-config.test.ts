import type { LinkCodePluginSettings } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  buildPluginConfigPatch,
  pluginConfigDefaults,
  validatePluginConfigField,
} from '../linkcode-config';

const SETTINGS: LinkCodePluginSettings = {
  account: { type: 'string', required: true },
  password: { type: 'password', secret: true, required: true },
  preset: { type: 'enum', enum: ['163', 'qq'], default: '163' },
  nickname: { type: 'string' },
  maxBodyChars: { type: 'number', default: 8000 },
  readonly: { type: 'boolean', default: false },
};

describe('pluginConfigDefaults', () => {
  it('prefers stored values, then manifest defaults, then type defaults', () => {
    expect(
      pluginConfigDefaults(SETTINGS, {
        account: 'you@163.com',
        maxBodyChars: 4000,
        readonly: true,
      }),
    ).toEqual({
      account: 'you@163.com',
      password: '',
      preset: '163',
      nickname: '',
      maxBodyChars: '4000',
      readonly: true,
    });
  });

  it('always starts secret fields blank — the masked read never returns them', () => {
    expect(pluginConfigDefaults(SETTINGS, { password: 'never-sent' }).password).toBe('');
  });
});

describe('validatePluginConfigField', () => {
  it('rejects a blank required non-secret field', () => {
    expect(validatePluginConfigField(SETTINGS.account, '')).toBe('required');
    expect(validatePluginConfigField(SETTINGS.account, 'you@163.com')).toBe(true);
  });

  it('never rejects a blank secret — blank means keep the stored value', () => {
    expect(validatePluginConfigField(SETTINGS.password, '')).toBe(true);
  });

  it('rejects a non-numeric number field, blank optional number passes', () => {
    expect(validatePluginConfigField(SETTINGS.maxBodyChars, 'abc')).toBe('invalidNumber');
    expect(validatePluginConfigField(SETTINGS.maxBodyChars, '42')).toBe(true);
    expect(validatePluginConfigField(SETTINGS.maxBodyChars, '')).toBe(true);
  });

  it('always passes a boolean', () => {
    expect(validatePluginConfigField(SETTINGS.readonly, false)).toBe(true);
  });
});

describe('buildPluginConfigPatch', () => {
  it('converts types: numbers to numbers, booleans stay boolean, strings stay strings', () => {
    const patch = buildPluginConfigPatch(
      SETTINGS,
      {},
      {
        account: 'you@163.com',
        password: 'secret',
        preset: 'qq',
        nickname: '',
        maxBodyChars: '4000',
        readonly: true,
      },
    );
    expect(patch.set).toEqual({
      account: 'you@163.com',
      password: 'secret',
      preset: 'qq',
      maxBodyChars: 4000,
      readonly: true,
    });
    expect(patch.remove).toBeUndefined();
  });

  it('keeps a blank secret out of the patch (blank = keep the stored value)', () => {
    const patch = buildPluginConfigPatch(
      SETTINGS,
      {},
      {
        account: 'you@163.com',
        password: '',
        preset: '163',
        nickname: '',
        maxBodyChars: '8000',
        readonly: false,
      },
    );
    expect(patch.set).not.toHaveProperty('password');
  });

  it('removes a cleared optional field only when it had a stored value', () => {
    const withStored = buildPluginConfigPatch(
      SETTINGS,
      { nickname: 'old' },
      {
        ...pluginConfigDefaults(SETTINGS, { nickname: '' }),
      },
    );
    expect(withStored.remove).toEqual(['nickname']);

    const withoutStored = buildPluginConfigPatch(
      SETTINGS,
      {},
      {
        ...pluginConfigDefaults(SETTINGS, {}),
      },
    );
    expect(withoutStored.remove).toBeUndefined();
  });

  it('stores a value equal to the manifest default as a removal, so upgrades can change it', () => {
    const patch = buildPluginConfigPatch(
      SETTINGS,
      { preset: 'qq', maxBodyChars: 4000 },
      {
        ...pluginConfigDefaults(SETTINGS, { preset: 'qq', maxBodyChars: 4000 }),
        preset: '163',
        maxBodyChars: '8000',
      },
    );

    expect(patch.set).toBeUndefined();
    expect(patch.remove).toEqual(['preset', 'maxBodyChars']);
  });

  it('omits both sides of an empty patch', () => {
    const patch = buildPluginConfigPatch({ nickname: { type: 'string' } }, {}, { nickname: '' });
    expect(patch).toEqual({});
  });
});

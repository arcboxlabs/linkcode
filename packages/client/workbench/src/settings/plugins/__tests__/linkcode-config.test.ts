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
  // Dotted on purpose: `.` is legal in a setting id, and it is the shape react-hook-form would
  // otherwise read as a nested path. Form-value maps below key it as `body$max`.
  'body.max': { type: 'number', default: 8000 },
  readonly: { type: 'boolean', default: false },
};

describe('pluginConfigDefaults', () => {
  it('prefers stored values, then manifest defaults, then type defaults', () => {
    expect(
      pluginConfigDefaults(SETTINGS, {
        account: 'you@163.com',
        'body.max': 4000,
        readonly: true,
      }),
    ).toEqual({
      account: 'you@163.com',
      password: '',
      preset: '163',
      nickname: '',
      body$max: '4000',
      readonly: true,
    });
  });

  it('always starts secret fields blank — the masked read never returns them', () => {
    expect(pluginConfigDefaults(SETTINGS, { password: 'never-sent' }).password).toBe('');
  });
});

describe('validatePluginConfigField', () => {
  it('rejects a blank required non-secret field', () => {
    expect(validatePluginConfigField(SETTINGS.account, '', false)).toBe('required');
    expect(validatePluginConfigField(SETTINGS.account, 'you@163.com', false)).toBe(true);
  });

  it('treats a blank secret as keep only when a value is already configured', () => {
    expect(validatePluginConfigField(SETTINGS.password, '', true)).toBe(true);
    // A newly installed plugin has no stored secret to keep — blank is missing, not keep.
    expect(validatePluginConfigField(SETTINGS.password, '', false)).toBe('required');
  });

  it('rejects a non-numeric number field, blank optional number passes', () => {
    expect(validatePluginConfigField(SETTINGS['body.max'], 'abc', false)).toBe('invalidNumber');
    expect(validatePluginConfigField(SETTINGS['body.max'], '42', false)).toBe(true);
    expect(validatePluginConfigField(SETTINGS['body.max'], '', false)).toBe(true);
  });

  it('always passes a boolean', () => {
    expect(validatePluginConfigField(SETTINGS.readonly, false, true)).toBe(true);
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
        body$max: '4000',
        readonly: true,
      },
    );
    expect(patch.set).toEqual({
      account: 'you@163.com',
      password: 'secret',
      preset: 'qq',
      'body.max': 4000,
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
        body$max: '8000',
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
      { preset: 'qq', 'body.max': 4000 },
      {
        ...pluginConfigDefaults(SETTINGS, { preset: 'qq', 'body.max': 4000 }),
        preset: '163',
        body$max: '8000',
      },
    );

    expect(patch.set).toBeUndefined();
    expect(patch.remove).toEqual(['preset', 'body.max']);
  });

  it('carries a dotted setting id through the form key back to its real id', () => {
    // RHF nested the raw dotted key and left its flat default stale, dropping the edit on save.
    const patch = buildPluginConfigPatch(SETTINGS, { 'body.max': 4000 }, { body$max: '512' });

    expect(patch.set).toEqual({ 'body.max': 512 });
    expect(patch.remove).toBeUndefined();
  });

  it('ignores a nested form shape, which is what a raw dotted RHF name would produce', () => {
    const nested = { body: { max: '512' } } as unknown as Parameters<
      typeof buildPluginConfigPatch
    >[2];
    expect(buildPluginConfigPatch(SETTINGS, {}, nested)).toEqual({});
  });

  it('omits both sides of an empty patch', () => {
    const patch = buildPluginConfigPatch({ nickname: { type: 'string' } }, {}, { nickname: '' });
    expect(patch).toEqual({});
  });
});

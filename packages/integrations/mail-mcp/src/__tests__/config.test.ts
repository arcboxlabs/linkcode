import { describe, expect, it } from 'vitest';
import { ConfigError, inferPresetFromEmail, loadConfig } from '../config';

const RE_IMAP_PORT = /IMAP_PORT/;

describe('loadConfig presets', () => {
  it.each([
    ['163', 'imap.163.com', 993, 'smtp.163.com', 465],
    ['qq', 'imap.qq.com', 993, 'smtp.qq.com', 465],
    ['exmail', 'imap.exmail.qq.com', 993, 'smtp.exmail.qq.com', 465],
  ] as const)(
    'preset=%s fills host/port and secure=true',
    (preset, imapHost, imapPort, smtpHost, smtpPort) => {
      const cfg = loadConfig({ MAIL_USER: 'u@x.com', MAIL_PASSWORD: 'code', MAIL_PRESET: preset });
      expect(cfg.imap.host).toBe(imapHost);
      expect(cfg.imap.port).toBe(imapPort);
      expect(cfg.imap.secure).toBe(true);
      expect(cfg.smtp.host).toBe(smtpHost);
      expect(cfg.smtp.port).toBe(smtpPort);
      expect(cfg.smtp.secure).toBe(true);
    },
  );

  it('corrects a mismatched configured preset from a QQ account suffix', () => {
    const cfg = loadConfig({
      MAIL_USER: 'user@qq.com',
      MAIL_PASSWORD: 'qq-authorisation-code',
      MAIL_PRESET: '163',
    });
    expect(cfg.imap.host).toBe('imap.qq.com');
    expect(cfg.smtp.host).toBe('smtp.qq.com');
  });

  it('infers a preset when the account suffix is known and MAIL_PRESET is absent', () => {
    const cfg = loadConfig({ MAIL_USER: 'user@163.com', MAIL_PASSWORD: '163-authorisation-code' });
    expect(cfg.imap.host).toBe('imap.163.com');
    expect(cfg.smtp.host).toBe('smtp.163.com');
  });

  it('defaults SMTP_USER/SMTP_PASSWORD/SMTP_FROM to the mail account', () => {
    const cfg = loadConfig({ MAIL_USER: 'u@163.com', MAIL_PASSWORD: 'code', MAIL_PRESET: '163' });
    expect(cfg.smtp.user).toBe('u@163.com');
    expect(cfg.smtp.password).toBe('code');
    expect(cfg.smtpFrom).toBe('u@163.com');
  });
});

describe('inferPresetFromEmail', () => {
  it.each([
    ['person@qq.com', 'qq'],
    ['PERSON@163.COM', '163'],
    ['person@example.com', null],
  ] as const)('maps %s to %s', (email, expected) => {
    expect(inferPresetFromEmail(email)).toBe(expected);
  });
});

describe('loadConfig overrides', () => {
  it('custom IMAP host with IMAP_SECURE=false derives port 143', () => {
    const cfg = loadConfig({
      MAIL_USER: 'u',
      MAIL_PASSWORD: 'p',
      MAIL_PRESET: '163',
      IMAP: 'imap.x.com',
      IMAP_SECURE: 'false',
    });
    expect(cfg.imap.host).toBe('imap.x.com');
    expect(cfg.imap.secure).toBe(false);
    expect(cfg.imap.port).toBe(143);
  });

  it('SMTP_USER/SMTP_PASSWORD/SMTP_FROM override', () => {
    const cfg = loadConfig({
      MAIL_USER: 'u',
      MAIL_PASSWORD: 'p',
      MAIL_PRESET: '163',
      SMTP_USER: 'smtpu',
      SMTP_PASSWORD: 'smtpp',
      SMTP_FROM: 'from@x.com',
    });
    expect(cfg.smtp.user).toBe('smtpu');
    expect(cfg.smtp.password).toBe('smtpp');
    expect(cfg.smtpFrom).toBe('from@x.com');
  });

  it('no preset falls back to default ports from secure', () => {
    const cfg = loadConfig({
      MAIL_USER: 'u',
      MAIL_PASSWORD: 'p',
      IMAP: 'imap.x.com',
      SMTP: 'smtp.x.com',
    });
    expect(cfg.imap.port).toBe(993);
    expect(cfg.smtp.port).toBe(465);
  });

  it('IMAP_PORT/SMTP_PORT override preset and default ports', () => {
    const cfg = loadConfig({
      MAIL_USER: 'u',
      MAIL_PASSWORD: 'p',
      MAIL_PRESET: '163',
      IMAP_PORT: '1993',
      SMTP_PORT: '2465',
    });
    expect(cfg.imap.port).toBe(1993);
    expect(cfg.smtp.port).toBe(2465);
  });

  it('rejects a non-numeric port', () => {
    expect(() =>
      loadConfig({ MAIL_USER: 'u', MAIL_PASSWORD: 'p', MAIL_PRESET: '163', IMAP_PORT: 'abc' }),
    ).toThrow(RE_IMAP_PORT);
  });
});

describe('loadConfig errors', () => {
  it('throws on missing MAIL_USER', () => {
    expect(() => loadConfig({ MAIL_PASSWORD: 'p', MAIL_PRESET: '163' })).toThrow(ConfigError);
  });
  it('throws on missing MAIL_PASSWORD', () => {
    expect(() => loadConfig({ MAIL_USER: 'u', MAIL_PRESET: '163' })).toThrow(ConfigError);
  });
  it('throws on missing host without preset', () => {
    expect(() => loadConfig({ MAIL_USER: 'u', MAIL_PASSWORD: 'p' })).toThrow(ConfigError);
  });
  it('throws on unknown preset', () => {
    expect(() => loadConfig({ MAIL_USER: 'u', MAIL_PASSWORD: 'p', MAIL_PRESET: 'gmail' })).toThrow(
      ConfigError,
    );
  });
});

describe('loadConfig maxBodyChars', () => {
  const base = { MAIL_USER: 'u', MAIL_PASSWORD: 'p', MAIL_PRESET: '163' };
  it('defaults to 8000', () => {
    expect(loadConfig(base).maxBodyChars).toBe(8000);
  });
  it('clamps below the minimum up to 100', () => {
    expect(loadConfig({ ...base, MAX_BODY_CHARS: '50' }).maxBodyChars).toBe(100);
  });
  it('clamps above the maximum down to 100000', () => {
    expect(loadConfig({ ...base, MAX_BODY_CHARS: '999999' }).maxBodyChars).toBe(100000);
  });
  it('falls back to default on garbage', () => {
    expect(loadConfig({ ...base, MAX_BODY_CHARS: 'garbage' }).maxBodyChars).toBe(8000);
  });
  it('accepts a valid value', () => {
    expect(loadConfig({ ...base, MAX_BODY_CHARS: '5000' }).maxBodyChars).toBe(5000);
  });
});

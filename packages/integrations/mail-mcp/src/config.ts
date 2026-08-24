import process from 'node:process';
import { clamp } from 'foxts/clamp';
import type { MailConfig, MailPreset } from './types';

const DEFAULT_MAX_BODY_CHARS = 8000;
const MIN_BODY_CHARS = 100;
const MAX_BODY_CHARS = 100000;

const PRESETS: Record<
  MailPreset,
  { imap: { host: string; port: number }; smtp: { host: string; port: number } }
> = {
  '163': { imap: { host: 'imap.163.com', port: 993 }, smtp: { host: 'smtp.163.com', port: 465 } },
  qq: { imap: { host: 'imap.qq.com', port: 993 }, smtp: { host: 'smtp.qq.com', port: 465 } },
  exmail: {
    imap: { host: 'imap.exmail.qq.com', port: 993 },
    smtp: { host: 'smtp.exmail.qq.com', port: 465 },
  },
};

const RE_TRUTHY = /^(?:1|true|yes|on)$/i;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return RE_TRUTHY.test(value.trim());
}

function parsePreset(value: string | undefined): MailPreset | null {
  if (value === undefined || value === '') return null;
  const lower = value.trim().toLowerCase();
  if (lower === '163' || lower === 'qq' || lower === 'exmail') return lower;
  throw new ConfigError(`MAIL_PRESET must be one of: 163, qq, exmail (got: ${value})`);
}

/** Infer the two consumer-mail presets whose domains uniquely identify their provider. */
export function inferPresetFromEmail(user: string): MailPreset | null {
  const domain = user.trim().toLowerCase().split('@').at(-1);
  if (domain === 'qq.com') return 'qq';
  if (domain === '163.com') return '163';
  return null;
}

function resolvePreset(user: string, configuredPreset: MailPreset | null): MailPreset | null {
  // The settings form has a backwards-compatible default of 163. Prefer a recognisable account
  // suffix so a QQ account cannot accidentally be sent to 163's IMAP/SMTP endpoints.
  return inferPresetFromEmail(user) ?? configuredPreset;
}

function defaultImapPort(secure: boolean): number {
  return secure ? 993 : 143;
}

function defaultSmtpPort(secure: boolean): number {
  return secure ? 465 : 587;
}

function parsePort(value: string | undefined, name: string): number | null {
  if (value === undefined || value === '') return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`${name} must be an integer between 1 and 65535 (got: ${value})`);
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MailConfig {
  const user = env.MAIL_USER?.trim();
  if (!user) throw new ConfigError('MAIL_USER is required');

  const password = env.MAIL_PASSWORD;
  if (!password) {
    throw new ConfigError(
      'MAIL_PASSWORD is required (the 163/QQ authorization code, not the login password)',
    );
  }

  const preset = resolvePreset(user, parsePreset(env.MAIL_PRESET));
  const presetHosts = preset ? PRESETS[preset] : null;

  const imapHost = env.IMAP?.trim() || presetHosts?.imap.host;
  if (!imapHost) {
    throw new ConfigError('IMAP host is required: set MAIL_PRESET=163|qq|exmail or provide IMAP');
  }

  const smtpHost = env.SMTP?.trim() || presetHosts?.smtp.host;
  if (!smtpHost) {
    throw new ConfigError('SMTP host is required: set MAIL_PRESET=163|qq|exmail or provide SMTP');
  }

  const imapSecure = parseBool(env.IMAP_SECURE, true);
  const smtpSecure = parseBool(env.SMTP_SECURE, true);
  // Precedence: explicit port env > preset's pinned port (host not overridden) > secure default.
  const imapPort =
    parsePort(env.IMAP_PORT, 'IMAP_PORT') ??
    (presetHosts && !env.IMAP ? presetHosts.imap.port : defaultImapPort(imapSecure));
  const smtpPort =
    parsePort(env.SMTP_PORT, 'SMTP_PORT') ??
    (presetHosts && !env.SMTP ? presetHosts.smtp.port : defaultSmtpPort(smtpSecure));

  const smtpUser = env.SMTP_USER?.trim() || user;
  // `||` not `??`: an empty SMTP_PASSWORD would otherwise log in with no credential.
  const smtpPassword = env.SMTP_PASSWORD || password;
  const smtpFrom = env.SMTP_FROM?.trim() || user;

  const parsedMax = Number(env.MAX_BODY_CHARS);
  const maxBodyChars =
    Number.isFinite(parsedMax) && parsedMax > 0
      ? clamp(Math.trunc(parsedMax), MIN_BODY_CHARS, MAX_BODY_CHARS)
      : DEFAULT_MAX_BODY_CHARS;

  return {
    imap: { host: imapHost, port: imapPort, secure: imapSecure, user, password },
    smtp: {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      password: smtpPassword,
    },
    smtpFrom,
    maxBodyChars,
  };
}

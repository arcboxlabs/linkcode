import { describe, expect, it, vi } from 'vitest';
import type { SmtpTransporter } from '../smtp';
import { MailSmtp } from '../smtp';
import type { MailConfig } from '../types';

function makeConfig(): MailConfig {
  return {
    imap: { host: 'h', port: 993, secure: true, user: 'me@x.com', password: 'p' },
    smtp: { host: 'h', port: 465, secure: true, user: 'me@x.com', password: 'p' },
    smtpFrom: 'me@x.com',
    maxBodyChars: 8000,
  };
}

function makeTransporter(): SmtpTransporter {
  return {
    sendMail: vi.fn().mockResolvedValue({ messageId: '<ok@x>', response: '250 OK' }),
    close: vi.fn(),
  };
}

describe('MailSmtp.send', () => {
  it('passes through addresses and reply headers, stamps from = smtpFrom', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<ok@x>', response: '250 OK' });
    const transporter: SmtpTransporter = { sendMail, close: vi.fn() };
    const smtp = new MailSmtp(makeConfig(), () => transporter);
    const result = await smtp.send({
      to: 'a@x.com',
      subject: 'hi',
      body: 'body',
      cc: 'c@x.com',
      inReplyTo: '<orig@x>',
      references: ['<r1@x>', '<r2@x>'],
    });
    expect(result).toEqual({ messageId: '<ok@x>', response: '250 OK' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const opts = sendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.from).toBe('me@x.com');
    expect(opts.to).toBe('a@x.com');
    expect(opts.cc).toBe('c@x.com');
    expect(opts.subject).toBe('hi');
    expect(opts.text).toBe('body');
    expect(opts.inReplyTo).toBe('<orig@x>');
    expect(opts.references).toEqual(['<r1@x>', '<r2@x>']);
  });

  it('returns an empty response string when the server omits it', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<ok@x>' });
    const smtp = new MailSmtp(makeConfig(), () => ({ sendMail, close: vi.fn() }));
    const result = await smtp.send({ to: 'a@x.com', subject: 's', body: 'b' });
    expect(result.response).toBe('');
  });
});

describe('MailSmtp.close', () => {
  it('closes a created transporter exactly once', async () => {
    const close = vi.fn();
    const transporter: SmtpTransporter = {
      sendMail: vi.fn().mockResolvedValue({ messageId: '<ok@x>', response: '250' }),
      close,
    };
    const smtp = new MailSmtp(makeConfig(), () => transporter);
    await smtp.send({ to: 'a@x.com', subject: 's', body: 'b' });
    await smtp.close();
    await smtp.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('is a no-op before any send', async () => {
    const smtp = new MailSmtp(makeConfig(), () => makeTransporter());
    await expect(smtp.close()).resolves.toBeUndefined();
  });
});

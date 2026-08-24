import { createTransport } from 'nodemailer';
import type { MailConfig } from './types';

export interface SendOptions {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly cc?: string;
  readonly bcc?: string;
  readonly html?: string;
  readonly replyTo?: string;
  readonly inReplyTo?: string;
  readonly references?: string | string[];
}

export interface SendResult {
  readonly messageId?: string;
  readonly response: string;
}

export interface SmtpTransporter {
  sendMail(options: Record<string, unknown>): Promise<{ messageId?: string; response?: string }>;
  close(): void;
}

export type SmtpTransporterFactory = (config: MailConfig) => SmtpTransporter;

export interface MailSmtpClient {
  send(opts: SendOptions): Promise<SendResult>;
  close(): Promise<void>;
}

export class MailSmtp implements MailSmtpClient {
  private transporter: SmtpTransporter | undefined;

  constructor(
    private readonly config: MailConfig,
    private readonly transporterFactory?: SmtpTransporterFactory,
  ) {}

  async send(opts: SendOptions): Promise<SendResult> {
    const transporter = this.ensureTransporter();
    const info = await transporter.sendMail({
      from: this.config.smtpFrom,
      to: opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      subject: opts.subject,
      text: opts.body,
      html: opts.html,
      replyTo: opts.replyTo,
      inReplyTo: opts.inReplyTo,
      references: opts.references,
    });
    return { messageId: info.messageId, response: info.response ?? '' };
  }

  close(): Promise<void> {
    const transporter = this.transporter;
    if (!transporter) return Promise.resolve();
    this.transporter = undefined;
    try {
      transporter.close();
    } catch {
      // best-effort; the MCP server is shutting down regardless
    }
    return Promise.resolve();
  }

  private ensureTransporter(): SmtpTransporter {
    if (this.transporter) return this.transporter;
    this.transporter = this.transporterFactory
      ? this.transporterFactory(this.config)
      : createSmtpTransporter(this.config);
    return this.transporter;
  }
}

function createSmtpTransporter(config: MailConfig): SmtpTransporter {
  return createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.password },
  });
}

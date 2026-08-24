export interface ImapEndpointConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
}

export interface SmtpEndpointConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
}

export interface MailConfig {
  readonly imap: ImapEndpointConfig;
  readonly smtp: SmtpEndpointConfig;
  readonly smtpFrom: string;
  readonly maxBodyChars: number;
}

export type MailPreset = '163' | 'qq' | 'exmail';

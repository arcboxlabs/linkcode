export interface ProviderErrorDetails {
  statusCode?: number | null;
  code?: string;
  responseBody?: string;
  message?: string;
}

type BillingCode = 'insufficient_credits' | 'billing_unavailable';

function gatewayHost(baseUrl: unknown): boolean {
  if (typeof baseUrl !== 'string') return false;
  try {
    return new URL(baseUrl).hostname === 'gateway.linkcode.ai';
  } catch {
    return false;
  }
}

function typedCode(details: ProviderErrorDetails): BillingCode | undefined {
  const text = [details.code, details.responseBody, details.message].filter(Boolean).join(' ');
  if (text.includes('insufficient_credits')) return 'insufficient_credits';
  if (text.includes('billing_unavailable')) return 'billing_unavailable';
  if (details.statusCode === 402) return 'insufficient_credits';
  if (details.statusCode === 503) return 'billing_unavailable';
  return undefined;
}

export function linkCodeGatewayError(
  baseUrl: unknown,
  details: ProviderErrorDetails,
): { message: string; code: BillingCode; recoverable: true } | undefined {
  if (!gatewayHost(baseUrl)) return undefined;
  const code = typedCode(details);
  if (!code) return undefined;
  const message =
    code === 'insufficient_credits'
      ? 'LinkCode Gateway credits are insufficient'
      : 'LinkCode Gateway billing is temporarily unavailable';
  return { message, code, recoverable: true };
}

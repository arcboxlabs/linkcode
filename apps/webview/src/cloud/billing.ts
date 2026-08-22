import type { CloudBillingSummary } from '@linkcode/workbench';
import { CloudBillingSummarySchema } from '@linkcode/workbench';
import { CLOUD_API_URL } from './auth';

export async function fetchCloudBillingSummary(
  organizationId: string,
): Promise<CloudBillingSummary> {
  const res = await fetch(
    `${CLOUD_API_URL}/organizations/${encodeURIComponent(organizationId)}/billing/summary`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(`fetchCloudBillingSummary: ${res.status} ${res.statusText}`);
  return CloudBillingSummarySchema.parse(await res.json());
}

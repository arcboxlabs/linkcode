import { listAssets } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/**
 * Managed-asset store status (CODE-111): per asset, the version this host wants and whether
 * it is installed. Pull-only for now — the download trigger and progress broadcast land with
 * the onboarding UI (CODE-112), which will also add push invalidation; until then a background
 * install is only visible on the next read.
 */
export function useAssets() {
  return useData(listAssets, {});
}

import type { PluginConfigSet } from '@linkcode/schema';
import { getPluginCatalog, getPluginConfig, setPluginConfig } from '@linkcode/sdk';
import { useData, useMutation } from '../../runtime/tayori';

/** Catalog and masked plugin state, plus a mutation that revalidates state after host acknowledgement. */
export function usePluginSettings() {
  const catalog = useData(getPluginCatalog, {});
  const config = useData(getPluginConfig, {});
  const mutation = useMutation(setPluginConfig);

  const save = async (plugins: PluginConfigSet): Promise<void> => {
    await mutation.trigger({ plugins });
    await config.mutate();
  };

  return {
    catalog: catalog.data,
    config: config.data,
    error: catalog.error ?? config.error ?? mutation.error,
    isLoading: catalog.isLoading || config.isLoading,
    isMutating: mutation.isMutating,
    save,
  };
}

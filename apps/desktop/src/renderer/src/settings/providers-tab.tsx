import { ProvidersSettingsPanel } from '@linkcode/workbench';
import { cloudDataBridge } from '../cloud-auth/bridges';
import { useCloudAccount } from '../cloud-auth/use-cloud-account';

// A transport-backed workbench container: reachable above the connection gate (the `ungated`
// slot), degrading to loading/error while the daemon is unreachable — like the history-import tab.
export function ProvidersTab(): React.ReactNode {
  const cloud = useCloudAccount();
  return (
    <ProvidersSettingsPanel
      linkCodeGateway={{
        signedIn: cloud.account !== null,
        signingIn: cloud.authenticating,
        signIn: cloud.signIn,
        createKey: cloudDataBridge.createGatewayKey,
      }}
    />
  );
}

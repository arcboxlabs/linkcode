import { ProvidersSettingsPanel } from '@linkcode/workbench';
import { cloudDataBridge } from '../cloud-auth/bridges';
import { useCloudAccount } from '../cloud-auth/use-cloud-account';
import { systemBridge } from '../ipc';

// Build-time snapshot (CODE-618): read once, like app.tsx's — it never changes for the life of
// this process.
const { allowedAgents, allowedServices } = systemBridge.identity.restrictions();

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
      allowedAgents={allowedAgents}
      allowedServices={allowedServices}
    />
  );
}

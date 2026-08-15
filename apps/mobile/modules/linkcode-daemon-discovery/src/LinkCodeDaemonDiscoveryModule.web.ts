import { NativeModule, registerWebModule } from 'expo';

import type { LinkCodeDaemonDiscoveryModuleEvents } from './LinkCodeDaemonDiscovery.types';

class LinkCodeDaemonDiscoveryModule extends NativeModule<LinkCodeDaemonDiscoveryModuleEvents> {}

export default registerWebModule(LinkCodeDaemonDiscoveryModule, 'LinkCodeDaemonDiscovery');

import { NativeModule, requireNativeModule } from 'expo';

import type { LinkCodeDaemonDiscoveryModuleEvents } from './LinkCodeDaemonDiscovery.types';

declare class LinkCodeDaemonDiscoveryModule extends NativeModule<LinkCodeDaemonDiscoveryModuleEvents> {}

export default requireNativeModule<LinkCodeDaemonDiscoveryModule>('LinkCodeDaemonDiscovery');

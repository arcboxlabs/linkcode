import { Platform } from 'react-native';

/** iOS 26 reshapes navigation chrome: inline titles, glass-grouped native bar items, and the
 * tab bar's separated trailing slot. Pre-26 iOS and Android keep the classic arrangement. */
export const USES_IOS_26_NAVIGATION =
  Platform.OS === 'ios' && Number.parseInt(Platform.Version, 10) >= 26;

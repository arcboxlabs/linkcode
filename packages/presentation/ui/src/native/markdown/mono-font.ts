import { Platform } from 'react-native';

/** Menlo is an Apple font; without the select Android silently falls back to proportional sans
 * and code loses column alignment. */
export const MONO_FONT_FAMILY = Platform.select({ ios: 'Menlo', default: 'monospace' });

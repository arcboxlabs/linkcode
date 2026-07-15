import { Platform } from 'react-native';

/**
 * Platform monospace for paths, commands, and diffs (design §1: mono is mandatory from M1;
 * IBM Plex Mono is an M3 option). RN needs a concrete family name — there is no `ui-monospace`.
 */
export const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

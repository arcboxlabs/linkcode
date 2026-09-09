import type { ColorValue } from 'react-native';

/** Semantic palette bridging RN-drawn surfaces to each platform's NATIVE colors: adaptive
 * `PlatformColor` system colors on iOS, Material You dynamic roles on Android. Components take
 * roles from here instead of the app's own brand tokens. */
export interface NativePalette {
  /** Screens and navigation chrome. */
  background: ColorValue;
  /** Grouped list/form screens, and the load states that stand in for them. */
  groupedBackground: ColorValue;
  /** Raised cards: composer, bubbles, prompt cards. */
  surface: ColorValue;
  text: ColorValue;
  textSecondary: ColorValue;
  /** Interactive accent (send, header tint). */
  tint: ColorValue;
  /** Content drawn on top of `tint`. */
  onTint: ColorValue;
  /** Hairline borders and idle indicators. */
  outline: ColorValue;
  danger: ColorValue;
  /** Status accents; Android maps to primary/tertiary — MD3 has no success/warning roles. */
  success: ColorValue;
  warning: ColorValue;
}

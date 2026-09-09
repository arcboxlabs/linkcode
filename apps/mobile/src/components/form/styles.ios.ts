import { font, foregroundStyle } from '@expo/ui/swift-ui/modifiers';

/** Hierarchical secondary text — captions, subtitles, section headers. */
export const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
/** Hierarchical tertiary text — chevrons, quiet chrome. */
export const TERTIARY = foregroundStyle({ type: 'hierarchical', style: 'tertiary' });
/** Footnote text style used on form section headers and row subtitles. */
export const FOOTNOTE = font({ textStyle: 'footnote' });

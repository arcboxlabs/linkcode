import { ProgressView } from '@expo/ui/swift-ui';
import { background, frame, padding, scaleEffect } from '@expo/ui/swift-ui/modifiers';
import { useNativePalette } from '@mobile/components/theme/native-palette';

/** Full-screen load state: the refresh spinner held where a drag refresh shows it — top-center
 * just below the header — mirroring the Android `PullToRefreshBox` position. The scale matches
 * the refresh control's spinner (larger than a bare ProgressView), and the grouped background
 * matches the Form/List screens this state stands in for. */
export function LoadingView(): React.ReactNode {
  const palette = useNativePalette();
  return (
    <ProgressView
      modifiers={[
        scaleEffect(1.6),
        padding({ top: 24 }),
        frame({
          maxWidth: Number.POSITIVE_INFINITY,
          maxHeight: Number.POSITIVE_INFINITY,
          alignment: 'top',
        }),
        background(palette.groupedBackground),
      ]}
    />
  );
}

/** In-section loading row: the same spinner centered in its form cell. */
export function FormLoadingRow(): React.ReactNode {
  return <ProgressView modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY })]} />;
}

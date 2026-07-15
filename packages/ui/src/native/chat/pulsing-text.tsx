import { useEffect } from 'react';
import type { TextStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

export interface PulsingTextProps {
  children: string;
  className?: string;
  weight?: TextStyle['fontWeight'];
}

/**
 * The running-state affordance: a simple opacity pulse on the label (design §2 —
 * deliberately not Paseo's two-platform gradient shimmer).
 */
export function PulsingText({ children, className, weight }: PulsingTextProps): React.ReactNode {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.45, { duration: 800 }), -1, true);
    return () => cancelAnimation(opacity);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.Text className={className} style={[animatedStyle, { fontWeight: weight }]}>
      {children}
    </Animated.Text>
  );
}

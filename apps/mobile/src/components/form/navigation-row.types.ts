export interface NavigationRowProps {
  title: string;
  subtitle?: string;
  /** Trailing status text, drawn the way a `List` row badge is. */
  badgeText?: string;
  onPress: () => void;
}

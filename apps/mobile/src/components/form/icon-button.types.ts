export interface NativeIconButtonProps {
  icon: 'send' | 'stop' | 'close' | 'previous' | 'next' | 'shield';
  label: string;
  onPress: () => void;
  disabled?: boolean;
  filled?: boolean;
}

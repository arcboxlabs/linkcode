export interface ActionButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'text' | 'destructive';
  fullWidth?: boolean;
}

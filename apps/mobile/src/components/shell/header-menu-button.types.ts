export interface HeaderMenuAction {
  id: string;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

export interface HeaderMenuButtonProps {
  /** Accessibility name of the trigger — icon buttons carry no visible text. */
  label: string;
  actions: HeaderMenuAction[];
}

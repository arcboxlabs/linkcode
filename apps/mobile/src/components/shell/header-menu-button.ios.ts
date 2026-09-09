import type { HeaderMenuButtonProps } from '@mobile/components/shell/header-menu-button.types';

/** iOS renders header menus as native `UIMenu` bar items; this twin exists so shared files can
 * reference one component name on both platforms. */
export function HeaderMenuButton(_props: HeaderMenuButtonProps): React.ReactNode {
  return null;
}

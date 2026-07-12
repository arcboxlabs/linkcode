import { isKeyboardShortcutLocalTarget, useKeyboardShortcut } from '@linkcode/ui';
import type { PanelSide } from '@linkcode/ui/shell/panels';
import type { WorkbenchShellNavigation } from '@linkcode/workbench';

const TOGGLE_SIDEBAR_SHORTCUT = { code: 'KeyB', modifiers: ['primary'] } as const;
const TOGGLE_BOTTOM_PANEL_SHORTCUT = { code: 'KeyJ', modifiers: ['primary'] } as const;
const TOGGLE_RIGHT_PANEL_SHORTCUT = {
  code: 'KeyB',
  modifiers: ['primary', 'alt'],
} as const;
const GO_BACK_SHORTCUT = {
  mac: { code: 'BracketLeft', modifiers: ['primary'] },
  nonMac: { code: 'ArrowLeft', modifiers: ['alt'] },
} as const;
const GO_FORWARD_SHORTCUT = {
  mac: { code: 'BracketRight', modifiers: ['primary'] },
  nonMac: { code: 'ArrowRight', modifiers: ['alt'] },
} as const;

interface UseDesktopShellShortcutsOptions {
  navigation: WorkbenchShellNavigation;
  owner: React.RefObject<Element | null>;
  togglePanel: (side: PanelSide) => void;
  updateSidebarOpen: (updater: boolean | ((current: boolean) => boolean)) => void;
}

export function useDesktopShellShortcuts({
  navigation,
  owner,
  togglePanel,
  updateSidebarOpen,
}: UseDesktopShellShortcutsOptions): void {
  useKeyboardShortcut({
    actionId: 'desktop.toggle-sidebar',
    shortcut: TOGGLE_SIDEBAR_SHORTCUT,
    owner,
    handler() {
      updateSidebarOpen((open) => !open);
      return true;
    },
  });

  useKeyboardShortcut({
    actionId: 'desktop.toggle-bottom-panel',
    shortcut: TOGGLE_BOTTOM_PANEL_SHORTCUT,
    owner,
    handler() {
      togglePanel('bottom');
      return true;
    },
  });

  useKeyboardShortcut({
    actionId: 'desktop.toggle-right-panel',
    shortcut: TOGGLE_RIGHT_PANEL_SHORTCUT,
    owner,
    handler() {
      togglePanel('right');
      return true;
    },
  });

  useKeyboardShortcut({
    actionId: 'workbench.go-back',
    shortcut: GO_BACK_SHORTCUT,
    owner,
    when: (event) => !isKeyboardShortcutLocalTarget(event.target),
    handler() {
      if (!navigation.canGoBack) return false;
      navigation.onBack();
      return true;
    },
  });

  useKeyboardShortcut({
    actionId: 'workbench.go-forward',
    shortcut: GO_FORWARD_SHORTCUT,
    owner,
    when: (event) => !isKeyboardShortcutLocalTarget(event.target),
    handler() {
      if (!navigation.canGoForward) return false;
      navigation.onForward();
      return true;
    },
  });
}

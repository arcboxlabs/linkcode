import { useHostRegistryStore, useSelectedHost } from '@mobile/stores/host-store';
import type { NativeStackHeaderItem, NativeStackHeaderItemMenuAction } from 'expo-router';
import { useRouter } from 'expo-router';
import { useTranslations } from 'use-intl';

/** The header's host switcher, as native bar-button items — a real `UIMenu`, not a drawn control.
 * Every tab spreads this into its own `unstable_headerLeftItems` so the switcher reads as app
 * chrome rather than a Threads feature.
 *
 * Switching writes the registry and stops: the host is not in the path, so nothing re-routes and
 * whichever tab you are standing in stays put. */
export function useHostMenuItems(): NativeStackHeaderItem[] {
  const t = useTranslations('mobile.connect');
  const tSettings = useTranslations('mobile.settings');
  const router = useRouter();
  const hosts = useHostRegistryStore((state) => state.hosts);
  const setLastActiveHostId = useHostRegistryStore((state) => state.setLastActiveHostId);
  const selected = useSelectedHost();

  if (!selected) return [];

  const hostActions: NativeStackHeaderItemMenuAction[] = hosts.map((host) => ({
    type: 'action',
    label: host.name,
    description: 'url' in host ? host.url : t('viaTunnel'),
    state: host.id === selected.id ? 'on' : 'off',
    onPress: () => setLastActiveHostId(host.id),
  }));

  return [
    {
      type: 'menu',
      // No `icon`: giving a menu item both an icon and a label makes UIKit draw the icon alone —
      // and, on iOS 26, suppresses the screen's large title along with it.
      label: selected.name,
      menu: {
        // Left non-multiselectable so UIKit draws the checkmark itself rather than us
        // spelling the selection out in the labels.
        items: [
          ...hostActions,
          {
            type: 'action',
            label: tSettings('manageHosts'),
            icon: { type: 'sfSymbol', name: 'gearshape' },
            onPress: () => router.push('/connect'),
          },
        ],
      },
    },
  ];
}

import { SheetPicker } from '@mobile/components/form/sheet-picker.android';
import { useChromeColors } from '@mobile/components/shell/use-chrome-colors';
import { useHostRegistryStore, useSelectedHost } from '@mobile/stores/host-store';
import { useRouter } from 'expo-router';
import { ChevronsUpDownIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { useTranslations } from 'use-intl';

/** Android host switcher: `unstable_headerLeftItems` is iOS-only, so the header carries a plain
 * pressable that opens the host list as a bottom sheet. Switching writes the registry and stops —
 * the host is not in the path, so whichever tab you are standing in stays put. */
export function HostSwitcherButton(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const tSettings = useTranslations('mobile.settings');
  const router = useRouter();
  const hosts = useHostRegistryStore((state) => state.hosts);
  const setLastActiveHostId = useHostRegistryStore((state) => state.setLastActiveHostId);
  const selected = useSelectedHost();
  const [open, setOpen] = useState(false);
  const chrome = useChromeColors();

  if (!selected) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selected.name}
        onPress={() => setOpen(true)}
        className="flex-row items-center gap-1 py-1 pr-3"
      >
        <Text
          className="font-semibold text-headline"
          style={{ color: chrome.title }}
          numberOfLines={1}
        >
          {selected.name}
        </Text>
        <ChevronsUpDownIcon size={14} color={chrome.subtle} />
      </Pressable>
      <SheetPicker
        open={open}
        onClose={() => setOpen(false)}
        sections={[
          {
            id: 'hosts',
            selection: selected.id,
            options: hosts.map((host) => ({
              id: host.id,
              label: host.name,
              hint: 'url' in host ? host.url : t('viaTunnel'),
            })),
            onSelect: setLastActiveHostId,
          },
        ]}
        actions={[
          {
            id: 'manage',
            label: tSettings('manageHosts'),
            onPress: () => router.push('/connect'),
          },
        ]}
      />
    </>
  );
}

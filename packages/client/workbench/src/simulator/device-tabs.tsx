import type { SimulatorDevice } from '@linkcode/schema';
import { MAX_SIMULATORS_PER_SESSION } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from 'coss-ui/components/menu';
import { PlusIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';

/**
 * The Simulator section's device tabs — one tab per open device, plus a + that adds another up to
 * the per-thread cap. Mirrors the terminal section's tab model, but lives inside the panel rather
 * than in the desktop chrome strip so webview gets the same behaviour.
 */
export function SimulatorDeviceTabs({
  devices,
  openUdids,
  activeUdid,
  onSelect,
  onClose,
  onOpen,
}: {
  devices: readonly SimulatorDevice[];
  openUdids: readonly string[];
  activeUdid: string | null;
  onSelect: (udid: string) => void;
  onClose: (udid: string) => void;
  onOpen: (udid: string) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const closable = openUdids.length > 1;
  const atCap = openUdids.length >= MAX_SIMULATORS_PER_SESSION;
  const addable = devices.filter((device) => !openUdids.includes(device.udid));

  return (
    <div role="tablist" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
      {openUdids.map((udid) => {
        const device = devices.find((item) => item.udid === udid);
        const active = udid === activeUdid;
        return (
          <div
            key={udid}
            className={`flex shrink-0 items-center rounded-md ${active ? 'bg-accent' : ''}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className={`max-w-40 truncate rounded-md px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active ? 'font-medium' : 'text-muted-foreground hover:bg-accent'
              }`}
              onClick={() => onSelect(udid)}
            >
              {/* A device that vanished from the host keeps its tab until closed, labelled by udid
                  so the row never silently turns blank. */}
              {device?.name ?? udid}
            </button>
            {device?.state === 'Booted' && (
              <span
                aria-label={t('simulatorBooted')}
                title={t('simulatorBooted')}
                className="size-1.5 shrink-0 rounded-full bg-emerald-500"
              />
            )}
            {closable && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="mr-0.5 size-5 text-muted-foreground"
                aria-label={t('simulatorCloseDevice')}
                onClick={() => onClose(udid)}
              >
                <XIcon className="size-3" />
              </Button>
            )}
          </div>
        );
      })}
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground"
              aria-label={atCap ? t('simulatorDeviceCap') : t('simulatorAddDevice')}
              disabled={atCap || addable.length === 0}
            >
              <PlusIcon className="size-4" />
            </Button>
          }
        />
        <MenuPopup>
          {addable.map((device) => (
            <MenuItem key={device.udid} onClick={() => onOpen(device.udid)}>
              <span className="flex items-center gap-2">
                <span className="truncate">
                  {device.runtimeName === undefined
                    ? device.name
                    : `${device.name} · ${device.runtimeName}`}
                </span>
                {device.state === 'Booted' && (
                  <span
                    aria-label={t('simulatorBooted')}
                    title={t('simulatorBooted')}
                    className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                  />
                )}
              </span>
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}

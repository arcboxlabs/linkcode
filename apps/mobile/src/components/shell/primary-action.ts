import type { LucideIcon } from 'lucide-react-native';
import { createContext, use, useEffect } from 'react';
import type { SFSymbol } from 'sf-symbols-typescript';

/** The one creation action a tab screen offers while focused. On iOS 26 the tab bar's separated
 * slot carries it; pre-26 iOS and Android render it as a trailing header button instead. */
export interface PrimaryAction {
  /** SF symbol for the native surfaces (tab-bar slot, header bar items). */
  sf: SFSymbol;
  /** Lucide twin for the RN header fallback on Android. */
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}

export type PrimaryActionRegistry = Readonly<Record<string, PrimaryAction | undefined>>;
export type RegisterPrimaryAction = (tab: string, action: PrimaryAction) => () => void;

/** Provided by {@link PrimaryActionScope}; split so screens registering never re-render when the
 * registry itself changes. */
export const RegisterPrimaryActionContext = createContext<RegisterPrimaryAction>(() => {
  throw new Error('usePrimaryAction requires a PrimaryActionScope ancestor');
});
export const PrimaryActionRegistryContext = createContext<PrimaryActionRegistry>({});

/** Declares the action `tab` offers; pass null while it is unavailable (host not ready). The
 * entry lives exactly as long as the screen and the availability window. */
export function usePrimaryAction(tab: string, action: PrimaryAction | null): void {
  const register = use(RegisterPrimaryActionContext);
  useEffect(() => {
    if (action) return register(tab, action);
  }, [register, tab, action]);
}

export function usePrimaryActions(): PrimaryActionRegistry {
  return use(PrimaryActionRegistryContext);
}

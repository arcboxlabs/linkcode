import type {
  PrimaryActionRegistry,
  RegisterPrimaryAction,
} from '@mobile/components/shell/primary-action';
import {
  PrimaryActionRegistryContext,
  RegisterPrimaryActionContext,
} from '@mobile/components/shell/primary-action';
import { useCallback, useState } from 'react';

/** Owns the tab → action registry. Wraps the tab navigator so the screens below declare their
 * action and the tab bar above them reads the focused one. */
export function PrimaryActionScope({ children }: React.PropsWithChildren): React.ReactNode {
  const [actions, setActions] = useState<PrimaryActionRegistry>({});
  const register = useCallback<RegisterPrimaryAction>((tab, action) => {
    setActions((previous) => ({ ...previous, [tab]: action }));
    return () => {
      setActions(({ [tab]: _removed, ...rest }) => rest);
    };
  }, []);
  return (
    <RegisterPrimaryActionContext value={register}>
      <PrimaryActionRegistryContext value={actions}>{children}</PrimaryActionRegistryContext>
    </RegisterPrimaryActionContext>
  );
}

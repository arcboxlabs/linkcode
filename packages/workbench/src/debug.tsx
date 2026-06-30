import { nullthrow } from 'foxact/nullthrow';
import type * as React from 'react';
import type { ReactNode } from 'react';
import { createContext, useContext, useMemo, useState } from 'react';

export interface DebugState {
  enableArtificialDelay: boolean;
  setEnableArtificialDelay: (value: boolean) => void;
  isLoadingOverride: boolean;
  setIsLoadingOverride: (value: boolean) => void;
}

const DebugContext = createContext<DebugState | null>(null);

export function DebugProvider({ children }: React.PropsWithChildren): ReactNode {
  const [enableArtificialDelay, setEnableArtificialDelay] = useState(false);
  const [isLoadingOverride, setIsLoadingOverride] = useState(false);

  const value = useMemo<DebugState>(
    () => ({
      enableArtificialDelay,
      setEnableArtificialDelay,
      isLoadingOverride,
      setIsLoadingOverride,
    }),
    [enableArtificialDelay, isLoadingOverride],
  );

  return <DebugContext.Provider value={value}>{children}</DebugContext.Provider>;
}

export function useDebug(): DebugState {
  return nullthrow(useContext(DebugContext), 'useDebug must be used within DebugProvider');
}

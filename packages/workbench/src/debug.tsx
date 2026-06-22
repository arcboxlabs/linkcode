import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react';

export interface DebugState {
  enableArtificialDelay: boolean;
  setEnableArtificialDelay: (value: boolean) => void;
  isLoadingOverride: boolean;
  setIsLoadingOverride: (value: boolean) => void;
}

const DebugContext = createContext<DebugState | null>(null);

export function DebugProvider({ children }: { children: ReactNode }): ReactElement {
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
  const value = useContext(DebugContext);
  if (!value) throw new Error('useDebug must be used inside <DebugProvider>');
  return value;
}

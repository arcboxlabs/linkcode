import { useEffect } from 'foxact/use-abortable-effect';
import { noop } from 'foxts/noop';
import { useState } from 'react';
import { AppState } from 'react-native';
import { registerMobileConfigBackgroundRefresh } from './background';
import { subscribeToForegroundRefresh } from './lifecycle';
import { initializeMobileConfiguration, refreshMobileConfiguration } from './mobile';

export function useMobileConfiguration(): boolean {
  const [ready, setReady] = useState(false);

  useEffect((signal) => {
    let unsubscribe = noop;
    void initializeMobileConfiguration().then(() => {
      if (signal.aborted) return;
      setReady(true);
      void refreshMobileConfiguration();
      void registerMobileConfigBackgroundRefresh();
      unsubscribe = subscribeToForegroundRefresh(AppState, () => {
        void refreshMobileConfiguration();
      });
    });
    return () => unsubscribe();
  }, []);

  return ready;
}

import { useEffect } from 'foxact/use-abortable-effect';
import { noop } from 'foxts/noop';
import { useState } from 'react';
import { AppState } from 'react-native';
import { registerMobileConfigBackgroundRefresh } from './background';
import { subscribeToEmergencyRefresh, subscribeToForegroundRefresh } from './lifecycle';
import {
  getMobileEmergencyState,
  initializeMobileConfiguration,
  refreshMobileConfiguration,
  refreshMobileEmergencyConfiguration,
} from './mobile';

export function useMobileConfiguration(): boolean {
  const [ready, setReady] = useState(false);

  useEffect((signal) => {
    let unsubscribe = noop;
    let unsubscribeEmergency = noop;
    void initializeMobileConfiguration().then(() => {
      if (signal.aborted) return;
      setReady(true);
      void refreshMobileConfiguration();
      void registerMobileConfigBackgroundRefresh();
      unsubscribe = subscribeToForegroundRefresh(AppState, () => {
        void refreshMobileConfiguration();
      });
      if (getMobileEmergencyState().support === 'active') {
        unsubscribeEmergency = subscribeToEmergencyRefresh(
          AppState,
          refreshMobileEmergencyConfiguration,
        );
      }
    });
    return () => {
      unsubscribe();
      unsubscribeEmergency();
    };
  }, []);

  return ready;
}

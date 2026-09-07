import { HostUrlSchema, useHostRegistryStore } from '@mobile/stores/host-store';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

/** Validation + submit flow of the add-host form. Field text stays in each platform view's own
 * `useNativeState` (the shared `@expo/ui` State export is the web polyfill, typed without
 * `.get()`), so submit takes the values instead of owning them. */
export function useAddHost(): {
  urlInvalid: boolean;
  urlValid: boolean;
  onUrlChange: (text: string) => void;
  submit: (rawName: string, rawUrl: string) => void;
} {
  const t = useTranslations('mobile.connect');
  const router = useRouter();
  const addHost = useHostRegistryStore((state) => state.addHost);
  const setLastActiveHostId = useHostRegistryStore((state) => state.setLastActiveHostId);
  const [urlInvalid, setUrlInvalid] = useState(false);
  const [urlValid, setUrlValid] = useState(false);

  const onUrlChange = (text: string) => {
    setUrlInvalid(false);
    setUrlValid(HostUrlSchema.safeParse(text.trim()).success);
  };

  const submit = (rawName: string, rawUrl: string) => {
    const trimmedUrl = rawUrl.trim();
    if (!HostUrlSchema.safeParse(trimmedUrl).success) {
      setUrlInvalid(true);
      return;
    }
    const profile = addHost({ name: rawName.trim() || t('namePlaceholder'), url: trimmedUrl });
    setLastActiveHostId(profile.id);
    router.dismissTo('/threads');
  };

  return { urlInvalid, urlValid, onUrlChange, submit };
}

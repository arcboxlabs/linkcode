import type { NativeStackNavigationOptions } from 'expo-router';

/** iOS threads search lives in the native search bar (`Stack.SearchBar`); there is no header
 * search view to configure. */
// eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix -- platform stub; the name must mirror the Android hook
export function useSearchHeaderOptions(_options: {
  open: boolean;
  placeholder: string;
  closeLabel: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
}): Partial<NativeStackNavigationOptions> {
  return {};
}

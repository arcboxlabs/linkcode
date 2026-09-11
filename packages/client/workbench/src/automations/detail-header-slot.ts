import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

const DetailHeaderSlotContext = createContext<HTMLDivElement | null>(null);

export const DetailHeaderSlotProvider = DetailHeaderSlotContext.Provider;

/**
 * Portals children into the fixed top-right slot `AutomationsView` renders beside its close
 * button, so a detail view's overflow menu stays anchored next to Close instead of scrolling
 * away with the rest of its content.
 */
export function DetailHeaderPortal({ children }: React.PropsWithChildren): React.ReactNode {
  const slot = useContext(DetailHeaderSlotContext);
  if (!slot) return null;
  return createPortal(children, slot);
}

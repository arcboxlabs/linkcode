import { useEffect } from 'react';

const TITLE_TEMPLATE = (title: string): string => `${title} · Link Code`;

/**
 * Per-page document title (the SPA equivalent of Next's `metadata.title`). Every page
 * calls this; the previous title is restored on unmount so transient routes don't leak.
 */
export function usePageTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = TITLE_TEMPLATE(title);
    return () => {
      document.title = previous;
    };
  }, [title]);
}

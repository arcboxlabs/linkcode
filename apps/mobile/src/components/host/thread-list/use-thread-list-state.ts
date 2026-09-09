import { useEffect, useState } from 'react';

const MINUTE = 60000;

/** Presentational state both platform lists share: which groups are collapsed (nothing outside
 * the list cares) and a once-a-minute clock for the relative timestamps. */
export function useThreadListState(): {
  collapsed: ReadonlySet<string>;
  setGroupExpanded: (key: string, expanded: boolean) => void;
  now: number;
} {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, []);

  const setGroupExpanded = (key: string, expanded: boolean) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (expanded) next.delete(key);
      else next.add(key);
      return next;
    });

  return { collapsed, setGroupExpanded, now };
}

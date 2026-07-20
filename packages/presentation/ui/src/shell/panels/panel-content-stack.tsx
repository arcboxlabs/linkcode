// Inactive tabs keep their layout box (so restty's ResizeObserver never sees a 0×0 container) but
// paint nothing — cheaper and safer than display:none, which would churn the PTY size on every switch.
const HIDDEN_TAB_STYLE: React.CSSProperties = { visibility: 'hidden' };

export interface PanelTabContentItem {
  id: string;
  active: boolean;
  node: React.ReactNode;
}

/** Mounts every item's content and toggles visibility rather than resolving one active node, so
 * each tab keeps its own mounted instance and live session instead of remounting on switch.
 * Callers render each tab's node themselves rather than passing a render callback down. */
export function PanelTabContentStack({
  items,
  style,
}: {
  items: PanelTabContentItem[];
  style?: React.CSSProperties;
}): React.ReactNode {
  return (
    <div className="relative h-full min-h-0" style={style}>
      {items.map(({ id, active, node }) => (
        <div
          key={id}
          className="absolute inset-0"
          style={active ? undefined : HIDDEN_TAB_STYLE}
          aria-hidden={!active}
          inert={!active}
        >
          {node}
        </div>
      ))}
    </div>
  );
}

import { PanelStubContent } from './free-panel';
import type { PanelTab, PanelWindowType } from './vocabulary';

// Inactive tabs keep their layout box (so restty's ResizeObserver never sees a 0×0 container) but
// paint nothing — cheaper and safer than display:none, which would churn the PTY size on every switch.
const HIDDEN_TAB_STYLE: React.CSSProperties = { visibility: 'hidden' };

/**
 * The tab-content layer of a panel: every tab stays mounted with only the active one visible, so
 * two tabs of the same type (e.g. two terminals) each keep their own live instance across switches.
 * Renders into a `relative` container; hosts portal it into whichever panel instance is visible so
 * stateful content survives the docked↔maximized handoff without remounting.
 */
export function PanelTabContents({
  tabs,
  activeTabId,
  contentByType,
}: {
  tabs: PanelTab[];
  activeTabId: string | null;
  contentByType?: Partial<Record<PanelWindowType, (tab: PanelTab) => React.ReactNode>>;
}): React.ReactNode {
  return tabs.map((tab) => {
    const active = tab.id === activeTabId;
    return (
      <div
        key={tab.id}
        className="absolute inset-0"
        style={active ? undefined : HIDDEN_TAB_STYLE}
        aria-hidden={!active}
        inert={!active}
      >
        {contentByType?.[tab.type]?.(tab) ?? <PanelStubContent type={tab.type} />}
      </div>
    );
  });
}

import { describe, expect, it } from 'vitest';
import { changedAccordionValues, openThreadGroupValues } from '../shell/accordion-values';

describe('changedAccordionValues', () => {
  it('reports the active thread group when it closes and reopens', () => {
    const activeGroup = 'workspace:active-thread';
    const otherGroup = 'workspace:other';
    const groups = [activeGroup, otherGroup];

    expect(changedAccordionValues(groups, groups, [otherGroup])).toEqual([activeGroup]);
    expect(changedAccordionValues(groups, [otherGroup], groups)).toEqual([activeGroup]);
  });

  it('closes a collapsed group even when its preview still contains the active thread', () => {
    const activeThread = { sessionId: 'active-thread' };
    const groups = [
      {
        collapseKey: 'workspace:active-thread',
        collapsed: true,
        visibleSessions: [activeThread],
      },
      {
        collapseKey: 'workspace:other',
        collapsed: false,
        visibleSessions: [],
      },
    ];

    expect(openThreadGroupValues(groups)).toEqual(['workspace:other']);
  });
});

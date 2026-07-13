import type { AgentCommand } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { buildComposerCommandGroups } from '../shell/composer-command';

const LABELS = { attach: 'Files', commands: 'Commands', mentions: 'Mentions' };
const CATALOG: AgentCommand[] = [
  { name: 'compact', description: 'Compact the context' },
  { name: 'review', argumentHint: '<pr>' },
];

function slashGroups(agentCommands: AgentCommand[], query = '') {
  return buildComposerCommandGroups({
    agentCommands,
    availableModes: [],
    commandSource: 'slash',
    currentModeId: null,
    labels: LABELS,
    mentionItems: [],
    modesEnabled: false,
    plusQuery: '',
    textTrigger: { kind: 'slash', query, start: 0 },
  });
}

describe('buildComposerCommandGroups slash catalog', () => {
  it('lists catalog commands first, with the description (or argument hint) as the hint', () => {
    const [group] = slashGroups(CATALOG);
    const commandEntries = group.items.filter((item) => item.kind === 'command');
    expect(commandEntries.map((item) => item.label)).toEqual(['/compact', '/review']);
    expect(commandEntries[0].hint).toBe('Compact the context');
    expect(commandEntries[1].hint).toBe('<pr>');
  });

  it('filters catalog commands by the typed query', () => {
    const [group] = slashGroups(CATALOG, 'rev');
    const values = group.items.reduce<string[]>((names, item) => {
      if (item.kind === 'command') names.push(item.value);
      return names;
    }, []);
    expect(values).toEqual(['review']);
  });

  it('keeps the mention redirect entry when the catalog is empty', () => {
    const [group] = slashGroups([]);
    expect(
      group.items.some((item) => item.kind === 'action' && item.id === 'mention-command'),
    ).toBe(true);
    expect(group.items.some((item) => item.kind === 'command')).toBe(false);
  });
});

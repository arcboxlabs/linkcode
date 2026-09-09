import type { AgentCommand } from '@linkcode/schema';
import { agentCommandMatches } from '@linkcode/schema';

interface MockCommandFixture {
  command: AgentCommand;
  reply?: string;
}

const MOCK_COMMAND_FIXTURES: MockCommandFixture[] = [
  {
    command: {
      name: 'compact',
      description: 'Summarize conversation to prevent hitting the context limit',
    },
    reply: 'Mock context compacted.',
  },
  {
    command: {
      name: 'review',
      description: 'Review the current changes',
      argumentHint: '<path>',
    },
    reply: 'Mock review complete: no blocking issues found.',
  },
  {
    command: {
      name: 'documents',
      description: 'Create and edit Word and Google Docs files',
      displayName: 'Documents',
      brandColor: '#2563EB',
      iconDataUri:
        'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiByeD0iNiIgZmlsbD0iIzI1NjNFQiIvPjxwYXRoIGQ9Ik03IDZoN2wzIDN2OUg3eiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=',
    },
    reply: 'Mock document created.',
  },
  {
    command: {
      name: 'sync-linear',
      description: 'Sync issues into the tracker',
      displayName: 'Linear',
      brandColor: '#5E6AD2',
    },
    reply: 'Mock issues synced.',
  },
  {
    command: {
      name: 'usage',
      description: 'Show session usage and rate limits',
      aliases: ['cost'],
    },
  },
];

export const MOCK_COMMAND_CATALOG: AgentCommand[] = MOCK_COMMAND_FIXTURES.map(
  ({ command }) => command,
);

export function mockCommandFixture(name: string): MockCommandFixture | undefined {
  return MOCK_COMMAND_FIXTURES.find(({ command }) => agentCommandMatches(command, name));
}

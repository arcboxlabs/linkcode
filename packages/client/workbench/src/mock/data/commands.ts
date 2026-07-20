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

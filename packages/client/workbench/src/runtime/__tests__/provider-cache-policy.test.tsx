// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { asyncNoop, noop } from 'foxts/noop';
import useSWR from 'swr';
import { afterEach, expect, it } from 'vitest';
import { DebugProvider } from '../debug';
import { WorkbenchRuntimeProvider } from '../provider';
import { TestTransport } from './connection-controller-test-helpers';

const connectionSource = {
  resolve: () => ({
    endpoint: 'http://daemon',
    transport: new TestTransport(asyncNoop),
  }),
};

function Transcript({ historyId }: { historyId: string }): React.ReactNode {
  const { data } = useSWR(historyId, () =>
    historyId === 'old' ? Promise.resolve('old transcript') : new Promise<string>(noop),
  );
  return <output data-testid="transcript">{data ?? 'empty'}</output>;
}

function Runtime({ historyId }: { historyId: string }): React.ReactNode {
  return (
    <DebugProvider>
      <WorkbenchRuntimeProvider connectionSource={connectionSource}>
        <Transcript historyId={historyId} />
      </WorkbenchRuntimeProvider>
    </DebugProvider>
  );
}

afterEach(cleanup);

it('does not carry identity-scoped data to a new pending key', async () => {
  const view = render(<Runtime historyId="old" />);
  await waitFor(() => expect(screen.getByTestId('transcript').textContent).toBe('old transcript'));

  view.rerender(<Runtime historyId="new" />);

  expect(screen.getByTestId('transcript').textContent).toBe('empty');
});

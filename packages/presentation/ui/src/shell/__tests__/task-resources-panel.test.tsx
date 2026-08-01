// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskResourcesPanel } from '../task-resources-panel';

vi.mock('use-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../use-relative-time-label', () => ({ useRelativeTimeLabel: () => 'recently' }));

afterEach(cleanup);

describe('TaskResourcesPanel', () => {
  it('renders separate source and output empty states and hides unsupported additions', () => {
    render(<TaskResourcesPanel resources={[]} />);

    expect(screen.getByText('sources')).toBeDefined();
    expect(screen.getByText('emptySources')).toBeDefined();
    expect(screen.getByText('outputs')).toBeDefined();
    expect(screen.getByText('emptyOutputs')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders populated rows with source and updated-time metadata', () => {
    render(
      <TaskResourcesPanel
        resources={[
          {
            id: 'source-1',
            direction: 'source',
            name: 'brief.pdf',
            kind: 'document',
            status: 'ready',
            source: 'Google Drive',
          },
          {
            id: 'output-1',
            direction: 'output',
            name: 'Launch page',
            kind: 'site',
            status: 'processing',
            updatedAt: 1,
          },
        ]}
      />,
    );

    expect(screen.getByText('brief.pdf')).toBeDefined();
    expect(screen.getByText('Google Drive')).toBeDefined();
    expect(screen.getByText('Launch page')).toBeDefined();
    expect(screen.getByText('recently')).toBeDefined();
  });

  it('renders the current plan between sources and outputs', () => {
    render(
      <TaskResourcesPanel
        resources={[
          {
            id: 'source-1',
            direction: 'source',
            name: 'brief.pdf',
            kind: 'document',
            status: 'ready',
          },
          {
            id: 'output-1',
            direction: 'output',
            name: 'report.md',
            kind: 'document',
            status: 'ready',
          },
        ]}
        plan={{
          currentIndex: 1,
          total: 3,
          complete: false,
          item: {
            kind: 'plan',
            id: 'plan-1',
            turnId: 'turn-1',
            plan: {
              planId: 'plan-1',
              entries: [
                { content: 'Read the code', priority: 'high', status: 'completed' },
                { content: 'Build the panel', priority: 'high', status: 'in_progress' },
                { content: 'Verify the result', priority: 'medium', status: 'pending' },
              ],
            },
          },
        }}
      />,
    );

    const source = screen.getByText('brief.pdf');
    const plan = screen.getByText('plan');
    const output = screen.getByText('report.md');
    expect(source.compareDocumentPosition(plan)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(plan.compareDocumentPosition(output)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText('Build the panel')).toBeDefined();
    expect(screen.getByRole('progressbar', { name: 'planProgress' })).toBeDefined();
  });

  it('shows a failure reason and retries only the failed resource', () => {
    const onRetry = vi.fn();
    const failed = {
      id: 'failed-1',
      direction: 'source' as const,
      name: 'notes.txt',
      kind: 'file' as const,
      status: 'failed' as const,
      error: 'Upload interrupted',
    };
    render(<TaskResourcesPanel resources={[failed]} onRetry={onRetry} />);

    expect(screen.getByText('Upload interrupted')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(onRetry).toHaveBeenCalledWith(failed);
  });
});

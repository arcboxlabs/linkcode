// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { Alert } from 'coss-ui/components/alert';
import { FileIcon } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Artifact } from '../artifact';
import { ArtifactFrame } from '../artifacts/artifact-frame';
import { CodeBlock } from '../code-block';
import { Commit } from '../commit';
import { FilePreviewCard } from '../file-preview-card';
import { PackageInfo } from '../package-info';
import { Queue, QueueItem } from '../queue';
import { SchemaDisplay, SchemaDisplayExample } from '../schema-display';
import { StackTrace } from '../stack-trace';
import { Step } from '../step';
import { Terminal } from '../terminal';
import { TestResults } from '../test-results';
import { ToolPreviewCard } from '../tool-preview-card';
import { TurnDiffSummary } from '../turn-diff-summary';
import { WebPreview } from '../web-preview';

// eslint-disable-next-line sukka/unicorn/consistent-function-scoping -- Vitest hoists inline mock factories.
vi.mock('use-intl', () => ({ useTranslations: () => (key: string) => key }));

afterEach(cleanup);

describe('Chat card chrome contract', () => {
  it('uses coss Frame chrome with a frame header for every core card surface', () => {
    const { container } = render(
      <>
        <ArtifactFrame code="" isIncomplete={false} kindLabel="artifact-frame">
          Frame
        </ArtifactFrame>
        <CodeBlock code="source" title="code-block" />
        <FilePreviewCard path="file.txt" />
        <Terminal title="terminal" />
        <ToolPreviewCard icon={FileIcon} title="tool-preview">
          Tool
        </ToolPreviewCard>
        <TurnDiffSummary edits={{ additions: 1, deletions: 0, files: [] }} />
      </>,
    );

    const frames = container.querySelectorAll(':scope > [data-slot="frame"]');
    expect(frames).toHaveLength(6);
    for (const frame of frames) {
      expect(frame.classList.contains('rounded-2xl')).toBe(true);
      // FrameHeader renders a literal <header>; render compositions may override its data-slot.
      expect(frame.querySelector('header')).not.toBeNull();
    }
  });

  it('renders a headerless code block as a bare frame panel', () => {
    const { container } = render(<CodeBlock code="source" />);

    expect(container.querySelector('[data-slot="frame"]')).toBeNull();
    const panel = container.querySelector(':scope > [data-slot="frame-panel"]');
    expect(panel?.classList.contains('rounded-xl')).toBe(true);
  });

  it('uses coss Card chrome for the remaining card surfaces', () => {
    const { container } = render(
      <>
        <Artifact>Artifact</Artifact>
        <PackageInfo packageInfo={{ id: 'package', name: 'package' }}>Package</PackageInfo>
        <Queue>Queue</Queue>
        <SchemaDisplay endpoint={{ id: 'endpoint', method: 'GET', path: '/status' }}>
          Schema
        </SchemaDisplay>
        <TestResults>Tests</TestResults>
        <WebPreview preview={{ id: 'preview', url: 'https://example.test' }}>Preview</WebPreview>
      </>,
    );

    const cards = container.querySelectorAll(':scope > [data-slot="card"]');
    expect(cards).toHaveLength(6);
    for (const card of cards) {
      expect(card.classList.contains('rounded-2xl')).toBe(true);
    }
  });

  it('keeps collapsible cards at 2xl without changing nested row and control radii', () => {
    render(
      <>
        <Commit commit={{ id: 'c', hash: '123', message: 'message' }} data-testid="commit">
          Commit
        </Commit>
        <StackTrace data-testid="stack-trace" stackTrace={{ id: 't', trace: 'Error' }}>
          Stack trace
        </StackTrace>
        <Step data-testid="step">Plan</Step>
        <ul>
          <QueueItem data-testid="queue-item" item={{ id: 'q', status: 'queued', title: 'row' }} />
        </ul>
        <SchemaDisplayExample data-testid="schema-example">example</SchemaDisplayExample>
        <div data-testid="turn-diff">
          <TurnDiffSummary edits={{ additions: 1, deletions: 0, files: [] }} />
        </div>
        <Alert data-testid="alert">Alert</Alert>
      </>,
    );

    for (const testId of ['commit', 'stack-trace', 'step']) {
      expect(screen.getByTestId(testId).classList.contains('rounded-2xl')).toBe(true);
    }

    expect(screen.getByTestId('queue-item').classList.contains('rounded-2xl')).toBe(false);
    expect(screen.getByTestId('schema-example').classList.contains('rounded-2xl')).toBe(false);
    expect(screen.getByRole('button', { name: 'undo' }).classList.contains('rounded-2xl')).toBe(
      false,
    );
    expect(screen.getByTestId('alert').classList.contains('rounded-2xl')).toBe(false);
  });
});

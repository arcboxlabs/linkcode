import { Badge } from 'coss-ui/components/badge';
import { CheckCircleIcon, CircleIcon, XCircleIcon } from 'lucide-react';
import prettyMilliseconds from 'pretty-ms';
import { cn } from '../lib/cn';

const EMPTY_TEST_RESULTS: readonly ChatTestResult[] = [];

// TODO(linkcode-schema): Provisional UI-only test result model, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when test tool outputs expose structured results.
export interface ChatTestResult {
  id: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  message?: string;
}

export type TestResultsProps = React.ComponentProps<'div'> & {
  testResults?: readonly ChatTestResult[];
};

export function TestResults({
  className,
  testResults = EMPTY_TEST_RESULTS,
  children,
  ...props
}: TestResultsProps): React.ReactNode {
  const summary = summarizeTests(testResults);

  return (
    <div
      className={cn(
        'my-2 overflow-hidden rounded-xl border border-border bg-card text-sm',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <TestResultsHeader summary={summary} />
          <div className="divide-y divide-border">
            {testResults.map((result) => (
              <TestResult key={result.id} result={result} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface TestSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export type TestResultsHeaderProps = React.ComponentProps<'div'> & {
  summary: TestSummary;
};

export function TestResultsHeader({
  className,
  summary,
  children,
  ...props
}: TestResultsHeaderProps): React.ReactNode {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-b border-border px-3 py-2',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <Badge variant={summary.failed > 0 ? 'error' : 'success'}>{summary.total} tests</Badge>
          <Badge variant="success">{summary.passed} passed</Badge>
          {summary.failed > 0 ? <Badge variant="error">{summary.failed} failed</Badge> : null}
          {summary.skipped > 0 ? <Badge variant="warning">{summary.skipped} skipped</Badge> : null}
        </>
      )}
    </div>
  );
}

export type TestResultProps = React.ComponentProps<'div'> & {
  result: ChatTestResult;
};

export function TestResult({
  className,
  result,
  children,
  ...props
}: TestResultProps): React.ReactNode {
  return (
    <div className={cn('flex min-w-0 items-start gap-2 px-3 py-2', className)} {...props}>
      <TestStatusIcon status={result.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-foreground">{children ?? result.name}</div>
        {result.message ? (
          <div className="mt-1 rounded-md bg-muted p-2 font-mono text-xs text-muted-foreground">
            {result.message}
          </div>
        ) : null}
      </div>
      {typeof result.durationMs === 'number' ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {prettyMilliseconds(result.durationMs)}
        </span>
      ) : null}
    </div>
  );
}

function summarizeTests(results: readonly ChatTestResult[]): TestSummary {
  return results.reduce<TestSummary>(
    (summary, result) => ({
      passed: summary.passed + (result.status === 'passed' ? 1 : 0),
      failed: summary.failed + (result.status === 'failed' ? 1 : 0),
      skipped: summary.skipped + (result.status === 'skipped' ? 1 : 0),
      total: summary.total + 1,
    }),
    { passed: 0, failed: 0, skipped: 0, total: 0 },
  );
}

function TestStatusIcon({ status }: { status: ChatTestResult['status'] }): React.ReactNode {
  const className = cn('mt-0.5 size-3.5 shrink-0', testStatusClass(status));

  switch (status) {
    case 'passed':
      return <CheckCircleIcon className={className} />;
    case 'failed':
      return <XCircleIcon className={className} />;
    default:
      return <CircleIcon className={className} />;
  }
}

function testStatusClass(status: ChatTestResult['status']): string {
  switch (status) {
    case 'passed':
      return 'text-success-foreground';
    case 'failed':
      return 'text-destructive-foreground';
    default:
      return 'text-warning-foreground';
  }
}

import type { UsageRateLimitWindow, UsageReport } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Card, CardHeader, CardPanel, CardTitle } from 'coss-ui/components/card';
import { useFormatter, useTranslations } from 'use-intl';

export function UsageReportCard({ report }: { report: UsageReport }): React.ReactNode {
  const t = useTranslations('workbench.usageReport');
  const format = useFormatter();
  const session = report.session;
  const windows = report.rateLimits?.windows ?? [];
  const day = report.behaviors?.day;
  const week = report.behaviors?.week;

  return (
    <div className="px-4 pb-3">
      <Card className="mx-auto max-w-3xl">
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-sm">{t('title')}</CardTitle>
          {report.subscriptionType && <Badge variant="secondary">{report.subscriptionType}</Badge>}
        </CardHeader>
        <CardPanel className="grid gap-4 p-4 pt-0 sm:grid-cols-2">
          <section>
            <h4 className="font-medium text-xs">{t('session')}</h4>
            <dl className="mt-2 space-y-1 text-xs">
              {session?.totalCostUsd !== undefined && (
                <Metric
                  label={t('cost')}
                  value={format.number(session.totalCostUsd, {
                    style: 'currency',
                    currency: 'USD',
                  })}
                />
              )}
              {session?.totalDurationMs !== undefined && (
                <Metric
                  label={t('duration')}
                  value={format.number(Math.round(session.totalDurationMs / 1000)) + 's'}
                />
              )}
              {(session?.totalLinesAdded !== undefined ||
                session?.totalLinesRemoved !== undefined) && (
                <Metric
                  label={t('lines')}
                  value={`+${session.totalLinesAdded ?? 0} / −${session.totalLinesRemoved ?? 0}`}
                />
              )}
            </dl>
            {session?.modelUsage && (
              <ul className="mt-3 space-y-1 text-muted-foreground text-xs">
                {Object.entries(session.modelUsage).map(([model, usage]) => (
                  <li key={model} className="flex justify-between gap-3">
                    <span className="truncate">{model}</span>
                    <span className="shrink-0 font-mono tabular-nums">
                      {(usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)} {t('tokens')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4 className="font-medium text-xs">{t('rateLimits')}</h4>
            {windows.length === 0 ? (
              <p className="mt-2 text-muted-foreground text-xs">{t('rateLimitsUnavailable')}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {windows.map((window) => (
                  <RateLimitWindow
                    key={`${window.id ?? ''}:${window.label ?? ''}:${window.durationMins ?? ''}`}
                    item={window}
                  />
                ))}
              </ul>
            )}
          </section>
          <AttributionSection title={t('lastDay')} window={day} />
          <AttributionSection title={t('lastWeek')} window={week} />
        </CardPanel>
      </Card>
    </div>
  );
}

function RateLimitWindow({ item }: { item: UsageRateLimitWindow }): React.ReactNode {
  const t = useTranslations('workbench.usageReport');
  const format = useFormatter();
  const label =
    item.label ?? (item.durationMins ? t('windowMinutes', { count: item.durationMins }) : item.id);
  return (
    <li className="text-xs">
      <div className="flex justify-between gap-3">
        <span>{label ?? t('window')}</span>
        <span className="font-mono tabular-nums">
          {item.utilization === null || item.utilization === undefined
            ? t('unavailable')
            : `${format.number(item.utilization, { maximumFractionDigits: 1 })}%`}
        </span>
      </div>
      {item.resetsAt && (
        <div className="text-muted-foreground text-2xs">
          {t('resets', {
            date: format.dateTime(new Date(item.resetsAt), {
              dateStyle: 'short',
              timeStyle: 'short',
            }),
          })}
        </div>
      )}
    </li>
  );
}

type BehaviorWindow = NonNullable<NonNullable<UsageReport['behaviors']>['day']>;

function AttributionSection({
  title,
  window,
}: {
  title: string;
  window: BehaviorWindow | undefined;
}): React.ReactNode {
  const t = useTranslations('workbench.usageReport');
  const rows = [
    ...(window?.skills ?? []).map((item) => ({ ...item, kind: t('skill') })),
    ...(window?.mcpServers ?? []).map((item) => ({ ...item, kind: t('mcp') })),
    ...(window?.agents ?? []).map((item) => ({ ...item, kind: t('agent') })),
    ...(window?.plugins ?? []).map((item) => ({ ...item, kind: t('plugin') })),
  ];
  if (!window) return null;
  return (
    <section>
      <h4 className="font-medium text-xs">{title}</h4>
      {rows.length === 0 ? (
        <p className="mt-2 text-muted-foreground text-xs">{t('attributionEmpty')}</p>
      ) : (
        <ul className="mt-2 space-y-1 text-xs">
          {rows.map((item) => (
            <li key={`${item.kind}-${item.name}`} className="flex justify-between gap-3">
              <span className="truncate">
                {item.kind} · {item.name}
              </span>
              <span className="shrink-0 font-mono tabular-nums">{item.pct}%</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

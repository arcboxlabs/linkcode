import { type AgentKind, AgentKindSchema } from '@linkcode/schema';
import { type ReactElement, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Button, Input } from '../components/ui';

export interface NewSessionFormProps {
  onCreate: (opts: { kind: AgentKind; cwd: string }) => void;
  onCancel: () => void;
}

/** Inline form to start a new agent session (agent kind + working directory). */
export function NewSessionForm({ onCreate, onCancel }: NewSessionFormProps): ReactElement {
  const t = useTranslations('workbench.newSession');
  const tk = useTranslations('workbench.agentKind');
  const [kind, setKind] = useState<AgentKind>('claude-code');
  const [cwd, setCwd] = useState('');
  const canCreate = cwd.trim().length > 0;

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3">
      <label htmlFor="new-session-agent" className="block">
        <span className="mb-1 block text-[11px] text-muted-foreground uppercase tracking-wide">
          {t('agent')}
        </span>
        <select
          id="new-session-agent"
          value={kind}
          onChange={(e) => setKind(e.target.value as AgentKind)}
          className="h-8 w-full rounded-lg border border-input bg-background px-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {AgentKindSchema.options.map((k) => (
            <option key={k} value={k}>
              {tk(k)}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="new-session-cwd" className="block">
        <span className="mb-1 block text-[11px] text-muted-foreground uppercase tracking-wide">
          {t('cwd')}
        </span>
        <Input
          id="new-session-cwd"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder={t('cwdPlaceholder')}
        />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button size="sm" disabled={!canCreate} onClick={() => onCreate({ kind, cwd: cwd.trim() })}>
          {t('create')}
        </Button>
      </div>
    </div>
  );
}

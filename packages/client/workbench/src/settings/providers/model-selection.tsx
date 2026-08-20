import { CURATED_AGENT_MODELS } from '@linkcode/providers';
import type { AccountModel, AccountSecret, AgentKind } from '@linkcode/schema';
import { getAgentCatalog, probeAccountModels } from '@linkcode/sdk';
import { cn } from '@linkcode/ui';
import { Button } from 'coss-ui/components/button';
import { Checkbox } from 'coss-ui/components/checkbox';
import { Input } from 'coss-ui/components/input';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { PlusIcon, RefreshCwIcon, StarIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useMutation } from '../../runtime/tayori';

/**
 * The account's model set: the ids its pickers will offer, and the only ones its sessions can run
 * on. Fetching is the caller's business — a catalog service is read from its own model list, a
 * subscription from the agent's start catalog, and an endpoint that lists nothing stays freeform.
 */
export interface ModelSelectionProps {
  /** Read the ids this account can offer. Absent when nothing can list them. */
  onFetch?: () => Promise<AccountModel[]>;
  selected: AccountModel[];
  onChange: (models: AccountModel[]) => void;
  disabled?: boolean;
  required?: boolean;
}

/**
 * Where the account forms read model ids from. The forms take these as a prop rather than calling
 * the data plane themselves: they are presentation, and only the settings page sits inside the
 * provider tree. Absent sources mean nothing can list, so every set is freeform.
 */
export interface ModelSources {
  /** Probe a catalog service with a secret the form has not saved yet. */
  probeInline: (service: string, secret: AccountSecret) => Promise<AccountModel[]>;
  /** Probe a saved account by id, leaving its stored secret on the daemon side. */
  probeAccount: (service: string, accountId: string) => Promise<AccountModel[]>;
  /** A subscription login holds no secret to probe with: codex enumerates its own models through
   * the start catalog, and claude-code has no enumeration API at all so the curated table stands
   * in for one. */
  oauth: (agent: AgentKind) => Promise<AccountModel[]>;
}

export function useModelSources(): ModelSources {
  const probe = useMutation(probeAccountModels);
  const fetchCatalog = useMutation(getAgentCatalog);
  return {
    probeInline: (service, secret) =>
      probe.trigger({ service, credential: { type: 'inline', secret } }),
    probeAccount: (service, accountId) =>
      probe.trigger({ service, credential: { type: 'account', accountId } }),
    async oauth(agent) {
      if (agent === 'claude-code') {
        return (CURATED_AGENT_MODELS[agent] ?? []).map(({ id, label }) => ({
          id,
          label: label ?? id,
        }));
      }
      const { models } = await fetchCatalog.trigger({ agentKind: agent });
      return models.map(({ id, label }) => ({ id, label }));
    },
  };
}

/** Fetched ids plus any already-picked id the fetch did not return — a freeform entry, or one the
 * vendor has since retired. Dropping the latter would silently unpick a working model. */
function rows(fetched: AccountModel[], selected: AccountModel[]): AccountModel[] {
  const known = new Set(fetched.map(({ id }) => id));
  return [...fetched, ...selected.filter(({ id }) => !known.has(id))];
}

export function ModelSelection({
  onFetch,
  selected,
  onChange,
  disabled = false,
  required = false,
}: ModelSelectionProps): React.ReactNode {
  const t = useTranslations('settings.providers');
  const [fetched, setFetched] = useState<AccountModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState('');

  const picked = new Set(selected.map(({ id }) => id));
  const listed = rows(fetched, selected);

  const refresh = async (): Promise<void> => {
    if (!onFetch) return;
    setLoading(true);
    setError(undefined);
    try {
      setFetched(await onFetch());
    } catch (error_) {
      // The vendor's own reason (bad key, unreachable host) is the whole value of the failure.
      setError(extractErrorMessage(error_, false) ?? t('models.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (model: AccountModel, next: boolean): void => {
    onChange(
      next ? [...selected, model] : selected.filter((candidate) => candidate.id !== model.id),
    );
  };

  const addDraft = (): void => {
    const id = draft.trim();
    if (!id || picked.has(id)) return;
    onChange([...selected, { id }]);
    setDraft('');
  };

  const makeDefault = (model: AccountModel): void => {
    onChange([model, ...selected.filter((candidate) => candidate.id !== model.id)]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">
          {t('models.label')}
          {required ? (
            <span aria-hidden="true" className="text-destructive">
              {' *'}
            </span>
          ) : null}
        </span>
        {onFetch ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || loading}
            onClick={() => {
              void refresh();
            }}
          >
            <RefreshCwIcon className={loading ? 'size-4 animate-spin' : 'size-4'} />
            {t('models.refresh')}
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        {onFetch ? t('models.hint') : t('models.hintUnlistable')}
      </p>
      {required && selected.length === 0 ? (
        <p aria-live="polite" className="text-destructive text-xs">
          {t('models.required')}
        </p>
      ) : null}
      {error !== undefined ? <p className="text-destructive text-xs">{error}</p> : null}
      {listed.length > 0 ? (
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
          {listed.map((model) => {
            const isPicked = picked.has(model.id);
            const isDefault = selected[0]?.id === model.id;
            return (
              <div
                className="flex min-w-0 items-center rounded-md hover:bg-muted/50"
                key={model.id}
              >
                <label className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-(--density-row-py)">
                  <Checkbox
                    checked={isPicked}
                    disabled={disabled}
                    onCheckedChange={(next) => toggle(model, next)}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{model.id}</span>
                  {model.label === undefined ? null : (
                    <span className="shrink-0 text-label-tertiary text-xs">{model.label}</span>
                  )}
                </label>
                {isPicked ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={disabled || isDefault}
                    aria-label={t(isDefault ? 'models.defaultModel' : 'models.makeDefault', {
                      model: model.label ?? model.id,
                    })}
                    className={cn(
                      'me-0.5 size-7 shrink-0 text-label-tertiary',
                      isDefault && 'disabled:opacity-100',
                    )}
                    onClick={() => makeDefault(model)}
                  >
                    <StarIcon className={isDefault ? 'size-3.5 fill-current' : 'size-3.5'} />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input
          autoComplete="off"
          className="flex-1"
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // Enter here adds an id; letting it bubble would submit the whole account form.
            event.preventDefault();
            addDraft();
          }}
          placeholder={t('models.addPlaceholder')}
          value={draft}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || draft.trim() === ''}
          onClick={addDraft}
        >
          <PlusIcon className="size-4" />
          {t('models.add')}
        </Button>
      </div>
    </div>
  );
}

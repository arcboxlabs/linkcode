import type {
  Account,
  AccountModel,
  AccountProtocol,
  Accounts,
  AgentKind,
  ProvidersConfig,
} from '@linkcode/schema';
import type { ResolvedBinding } from './resolve';
import { resolveBinding } from './resolve';

/** One model an agent may run on, paired with the account that serves it — the pair is the unit,
 * because two accounts legitimately serve the same model id. */
export interface EnabledAccountModel {
  account: Account;
  model: AccountModel;
}

/** Whether this account's models are offered for this agent. An absent list means every bindable
 * account, so an account added later is offered without a visit to Settings; an explicit list is the
 * user narrowing it. */
export function accountEnabledFor(
  providers: ProvidersConfig | undefined,
  kind: AgentKind,
  accountId: string,
): boolean {
  const enabled = providers?.[kind]?.enabledAccountIds;
  return enabled === undefined || enabled.includes(accountId);
}

/** The protocol this agent would actually bind the account on, or undefined when the binding
 * carries none — an oauth login, a pre-catalog bare key, or (after the caller's own tier check)
 * an unavailable account. */
function boundProtocol(binding: ResolvedBinding): AccountProtocol | undefined {
  return binding.tier === 'unavailable' ? undefined : binding.protocol;
}

/** Whether a picked model may be offered for a binding resolved to `protocol`. Unknown on either
 * side means offer: a model probed before `protocols` existed (or never probed — a pre-catalog
 * bare key, a hand-typed custom account) carries no set, and a binding with no protocol of its
 * own (same two cases) has nothing to check against. Only an explicit set on both sides can
 * narrow the result. */
function modelReachable(model: AccountModel, protocol: AccountProtocol | undefined): boolean {
  return (
    model.protocols === undefined || protocol === undefined || model.protocols.includes(protocol)
  );
}

/** How much of an account's picked set one agent can actually run: `picked` is the stored set,
 * `reachable` the part the protocol this agent binds answers. Counting rather than filtering is
 * what Settings needs — it names the shortfall next to the agent's own switch, and a set with no
 * `protocols` at all counts as fully reachable, matching `enabledAccountModels` and keeping an
 * un-probed account silent instead of alarming. */
export function accountModelReach(
  account: Account,
  kind: AgentKind,
): { picked: number; reachable: number } {
  const models = account.models ?? [];
  const protocol = boundProtocol(resolveBinding(account, kind));
  return {
    picked: models.length,
    reachable: models.reduce(
      (count, model) => (modelReachable(model, protocol) ? count + 1 : count),
      0,
    ),
  };
}

function resolvedAccounts(
  accounts: Accounts,
  providers: ProvidersConfig | undefined,
  kind: AgentKind,
): Array<{ account: Account; binding: ResolvedBinding }> {
  return accounts.reduce<Array<{ account: Account; binding: ResolvedBinding }>>(
    (resolved, account) => {
      const binding = resolveBinding(account, kind);
      if (binding.tier !== 'unavailable' && accountEnabledFor(providers, kind, account.id)) {
        resolved.push({ account, binding });
      }
      return resolved;
    },
    [],
  );
}

/**
 * Every model this agent may run on, in the order its pickers offer them: each enabled account in
 * pool order, contributing its picked set in its own order, narrowed to the models reachable on the
 * protocol this agent actually binds that account with. Availability still gates it — an enabled
 * account that cannot back this agent contributes nothing.
 *
 * **The first entry is the agent's default.** There is no stored default account or default model:
 * the client shows this list's head and the daemon starts on it for a request that names no model, so
 * the two cannot disagree about what "unpicked" means. That is the whole reason this list has one
 * implementation instead of one per side.
 */
export function enabledAccountModels(
  accounts: Accounts,
  providers: ProvidersConfig | undefined,
  kind: AgentKind,
): EnabledAccountModel[] {
  return resolvedAccounts(accounts, providers, kind).flatMap(({ account, binding }) => {
    const protocol = boundProtocol(binding);
    return (account.models ?? []).reduce<EnabledAccountModel[]>((models, model) => {
      if (modelReachable(model, protocol)) models.push({ account, model });
      return models;
    }, []);
  });
}

/** The accounts this agent may resolve to, in pool order. An account with no picked model is still
 * one of them: it contributes nothing to the pickers, but it can still back a session pinned to it,
 * and its credential is still what a signed-out CLI would run on. */
export function enabledAccounts(
  accounts: Accounts,
  providers: ProvidersConfig | undefined,
  kind: AgentKind,
): Account[] {
  return resolvedAccounts(accounts, providers, kind).map(({ account }) => account);
}

import type { Account, AccountModel, Accounts, AgentKind, ProvidersConfig } from '@linkcode/schema';
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

/**
 * Every model this agent may run on, in the order its pickers offer them: each enabled account in
 * pool order, contributing its picked set in its own order. Availability still gates it — an enabled
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
  return enabledAccounts(accounts, providers, kind).flatMap((account) =>
    (account.models ?? []).map((model) => ({ account, model })),
  );
}

/** The accounts this agent may resolve to, in pool order. An account with no picked model is still
 * one of them: it contributes nothing to the pickers, but it can still back a session pinned to it,
 * and its credential is still what a signed-out CLI would run on. */
export function enabledAccounts(
  accounts: Accounts,
  providers: ProvidersConfig | undefined,
  kind: AgentKind,
): Account[] {
  return accounts.filter(
    (account) =>
      resolveBinding(account, kind).tier !== 'unavailable' &&
      accountEnabledFor(providers, kind, account.id),
  );
}

import type { Account, AccountProtocol } from '@linkcode/schema';
import { z } from 'zod';
import type { ServiceDescriptor, ServiceVariant } from './catalog';
import { fillTemplate, templatePlaceholders } from './catalog';
import type { ImportedProvider } from './import-models-json';
import { accountSecret } from './view';

/**
 * Draft schemas and account constructors behind the add/edit account forms — hook-free (the React
 * Compiler forbids `Date.now`/`crypto.randomUUID` in a component body) and unit-testable. Each
 * constructor takes an optional `existing` account: absent builds a fresh account, present builds
 * a same-id replacement that carries over what the form doesn't cover.
 */

/** Identity plus the fields no form covers; edit (`existing` set) preserves them verbatim. */
function accountBase(
  label: string,
  existing: Account | undefined,
): Pick<Account, 'id' | 'label' | 'createdAt' | 'service' | 'extraEnv'> {
  if (!existing) {
    return { id: `acc_${crypto.randomUUID()}`, label: label.trim(), createdAt: Date.now() };
  }
  return {
    id: existing.id,
    label: label.trim(),
    createdAt: existing.createdAt,
    ...(existing.service !== undefined && { service: existing.service }),
    ...(existing.extraEnv !== undefined && { extraEnv: existing.extraEnv }),
  };
}

export function oauthAccount(
  service: Extract<ServiceDescriptor, { kind: 'oauth' }>,
  label: string,
): Account {
  return {
    ...accountBase(label, undefined),
    service: service.id,
    credential: { type: 'oauth', agent: service.agent },
  };
}

export const CatalogDraftSchema = z.object({
  label: z.string().min(1),
  secret: z.string().min(1),
  model: z.string(),
  placeholders: z.record(z.string(), z.string()),
});
export type CatalogDraft = z.infer<typeof CatalogDraftSchema>;

export function catalogDraftSchema(variant: ServiceVariant): typeof CatalogDraftSchema {
  return CatalogDraftSchema.superRefine((draft, ctx) => {
    for (const key of templatePlaceholders(variant.baseUrl)) {
      if (!draft.placeholders[key]?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['placeholders', key], message: 'required' });
      }
    }
  });
}

export function catalogAccount(
  service: Extract<ServiceDescriptor, { kind: 'endpoint' }>,
  variant: ServiceVariant,
  draft: CatalogDraft,
): Account {
  const trimmed: Record<string, string> = {};
  for (const key of templatePlaceholders(variant.baseUrl)) {
    trimmed[key] = draft.placeholders[key]?.trim() ?? '';
  }
  return {
    ...accountBase(draft.label, undefined),
    service: service.id,
    credential:
      variant.credentialType === 'auth-token'
        ? { type: 'auth-token', token: draft.secret }
        : { type: 'api-key', key: draft.secret },
    endpoint: { baseUrl: fillTemplate(variant.baseUrl, trimmed), protocol: variant.protocol },
    ...(draft.model.trim() && { model: draft.model.trim() }),
  };
}

export const CustomModelDraftSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  reasoning: z.boolean(),
  contextWindow: z.coerce.number<number>().int().positive(),
  maxTokens: z.coerce.number<number>().int().positive(),
});

export const CustomDraftSchema = z
  .object({
    label: z.string().min(1),
    type: z.enum(['api-key', 'auth-token']),
    secret: z.string().min(1),
    baseUrl: z.string(),
    protocol: z.string(),
    model: z.string(),
    providerName: z.string(),
    models: z.array(CustomModelDraftSchema),
  })
  .superRefine((draft, ctx) => {
    // A model list turns the account into a provider definition (pi registerProvider), which
    // needs a provider id and a complete endpoint (the api is derived from the protocol).
    if (draft.models.length === 0) return;
    if (!draft.providerName.trim() || draft.providerName.includes('/')) {
      // Slash-free: the first '/' in a model ref splits provider from model id (schema rule).
      ctx.addIssue({ code: 'custom', path: ['providerName'], message: 'required' });
    }
    if (!draft.baseUrl.trim()) {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'required' });
    }
    if (!draft.protocol) ctx.addIssue({ code: 'custom', path: ['protocol'], message: 'required' });
  });
export type CustomDraft = z.infer<typeof CustomDraftSchema>;

export function customAccount(draft: CustomDraft, existing?: Account): Account {
  const protocol = draft.protocol as AccountProtocol | '';
  const priorModels = existing?.customProvider?.models;
  return {
    ...accountBase(draft.label, existing),
    credential:
      draft.type === 'auth-token'
        ? { type: 'auth-token', token: draft.secret }
        : { type: 'api-key', key: draft.secret },
    ...(draft.baseUrl.trim() &&
      protocol && { endpoint: { baseUrl: draft.baseUrl.trim(), protocol } }),
    ...(draft.models.length > 0 && {
      customProvider: {
        name: draft.providerName.trim(),
        models: draft.models.map((model) => {
          const id = model.id.trim();
          // Rows kept by id keep the fields the form doesn't cover (models.json fidelity).
          const prior = priorModels?.find((candidate) => candidate.id === id);
          return {
            id,
            ...(model.name.trim() && { name: model.name.trim() }),
            reasoning: model.reasoning,
            input: prior?.input ?? ['text' as const],
            cost: prior?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            ...(prior?.thinkingLevelMap && { thinkingLevelMap: prior.thinkingLevelMap }),
          };
        }),
      },
    }),
    ...(draft.model.trim() && { model: draft.model.trim() }),
  };
}

/** The custom-form draft an existing key/token account prefills; never call for oauth accounts. */
export function customDraftFromAccount(account: Account): CustomDraft {
  return {
    label: account.label,
    type: account.credential.type === 'auth-token' ? 'auth-token' : 'api-key',
    secret: accountSecret(account) ?? '',
    baseUrl: account.endpoint?.baseUrl ?? '',
    protocol: account.endpoint?.protocol ?? '',
    model: account.model ?? '',
    providerName: account.customProvider?.name ?? '',
    models: (account.customProvider?.models ?? []).map((model) => ({
      id: model.id,
      name: model.name ?? '',
      reasoning: model.reasoning,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })),
  };
}

export function importedAccount(provider: ImportedProvider): Account {
  return {
    ...accountBase(provider.name, undefined),
    credential: { type: 'api-key', key: provider.apiKey },
    endpoint: { baseUrl: provider.baseUrl, protocol: provider.protocol },
    customProvider: { name: provider.name, models: provider.models },
  };
}

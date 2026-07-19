import type { AccountCustomModel, AccountProtocol } from '@linkcode/schema';
import { AccountCustomModelSchema } from '@linkcode/schema';
import { z } from 'zod';

/**
 * Parser behind the "Import models.json" flow: pi's own custom-provider file, mapped onto
 * custom-provider account drafts (one per provider entry). Full fidelity where the manual form
 * is minimal — `cost`, `thinkingLevelMap`, and `input` come through from the file. Plain JSON
 * only (pi tolerates JSONC comments; we do not — the parse error says so).
 */

/** pi wire `api` → the account endpoint protocol it corresponds to. */
const PROTOCOL_BY_PI_API: Record<string, AccountProtocol> = {
  'openai-completions': 'openai-chat',
  'openai-responses': 'openai-responses',
  'anthropic-messages': 'anthropic',
};

const ModelsJsonModelSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.enum(['text', 'image'])).optional(),
  cost: z
    .looseObject({
      input: z.number().optional(),
      output: z.number().optional(),
      cacheRead: z.number().optional(),
      cacheWrite: z.number().optional(),
    })
    .optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  thinkingLevelMap: z.record(z.string(), z.string().nullable()).optional(),
});

const ModelsJsonProviderSchema = z.looseObject({
  baseUrl: z.string().optional(),
  api: z.string().optional(),
  apiKey: z.string().optional(),
  models: z.array(ModelsJsonModelSchema).optional(),
});

const ModelsJsonSchema = z.looseObject({
  providers: z.record(z.string(), ModelsJsonProviderSchema),
});

/** pi's file leaves contextWindow/maxTokens optional with loader-side defaults; mirror them. */
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 8192;

export type ImportSkipReason =
  | 'no-models'
  | 'missing-base-url'
  | 'missing-api-key'
  | 'unsupported-api'
  | 'invalid-name';

export interface ImportedProvider {
  name: string;
  baseUrl: string;
  protocol: AccountProtocol;
  apiKey: string;
  models: AccountCustomModel[];
}

export interface ModelsJsonImport {
  providers: ImportedProvider[];
  skipped: Array<{ name: string; reason: ImportSkipReason }>;
}

/** Parse a models.json document; throws with the JSON/schema error message on a malformed file. */
export function parseModelsJson(text: string): ModelsJsonImport {
  const document = ModelsJsonSchema.parse(JSON.parse(text));
  const result: ModelsJsonImport = { providers: [], skipped: [] };
  for (const [name, entry] of Object.entries(document.providers)) {
    // Entries without models are built-in overrides (baseUrl/headers only) — nothing an account
    // can represent.
    if (!entry.models || entry.models.length === 0) {
      result.skipped.push({ name, reason: 'no-models' });
      continue;
    }
    // Slash-free provider names only: the first '/' in a model ref splits provider from model id.
    if (name.includes('/')) {
      result.skipped.push({ name, reason: 'invalid-name' });
      continue;
    }
    const protocol = entry.api === undefined ? undefined : PROTOCOL_BY_PI_API[entry.api];
    if (!protocol) {
      result.skipped.push({ name, reason: 'unsupported-api' });
      continue;
    }
    if (!entry.baseUrl) {
      result.skipped.push({ name, reason: 'missing-base-url' });
      continue;
    }
    if (!entry.apiKey) {
      result.skipped.push({ name, reason: 'missing-api-key' });
      continue;
    }
    result.providers.push({
      name,
      baseUrl: entry.baseUrl,
      protocol,
      apiKey: entry.apiKey,
      models: entry.models.map((model) =>
        AccountCustomModelSchema.parse({
          id: model.id,
          ...(model.name !== undefined && { name: model.name }),
          ...(model.reasoning !== undefined && { reasoning: model.reasoning }),
          ...(model.input !== undefined && { input: model.input }),
          ...(model.cost !== undefined && {
            cost: {
              input: model.cost.input ?? 0,
              output: model.cost.output ?? 0,
              cacheRead: model.cost.cacheRead ?? 0,
              cacheWrite: model.cost.cacheWrite ?? 0,
            },
          }),
          contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
          maxTokens: model.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(model.thinkingLevelMap !== undefined && {
            thinkingLevelMap: model.thinkingLevelMap,
          }),
        }),
      ),
    });
  }
  return result;
}

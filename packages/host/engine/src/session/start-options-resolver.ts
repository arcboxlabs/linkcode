import type { StartOptions } from '@linkcode/schema';
import { Effect } from 'effect';
import type { ProviderConfigStore } from '../agent/provider-config';
import { applyProviderDefaults } from '../agent/provider-config';
import type { TranslatorService } from '../agent/translator';
import { translationUpstream, withTranslatorEndpoint } from '../agent/translator';
import { OperationError, RequestError } from '../failure';

/** Resolves daemon-owned provider defaults and the optional cross-protocol translation endpoint. */
export class SessionStartOptionsResolver {
  constructor(
    private readonly providers: ProviderConfigStore,
    private readonly translator: TranslatorService | undefined,
  ) {}

  resolve(options: StartOptions): Effect.Effect<StartOptions, RequestError | OperationError> {
    const resolved = applyProviderDefaults(
      options,
      this.providers.get(),
      this.providers.getAccounts(),
    );
    const upstream = translationUpstream(resolved);
    if (!upstream) return Effect.succeed(resolved);
    if (!this.translator) {
      return Effect.fail(
        new RequestError({
          code: 'unsupported',
          message: 'Cross-protocol translation is unavailable',
        }),
      );
    }
    const translator = this.translator;
    return Effect.tryPromise({
      try: () => translator.ensure(upstream),
      catch: (cause) =>
        new OperationError({
          subsystem: 'translator',
          operation: 'translator.ensure',
          publicMessage: 'Failed to start cross-protocol translation',
          cause,
        }),
    }).pipe(Effect.map((url) => withTranslatorEndpoint(resolved, url)));
  }
}

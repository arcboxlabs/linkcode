import type { StartOptions } from '@linkcode/schema';
import type { ProviderConfigStore } from '../agent/provider-config';
import { applyProviderDefaults } from '../agent/provider-config';
import type { TranslatorService } from '../agent/translator';
import { translationUpstream, withTranslatorEndpoint } from '../agent/translator';

/** Resolves daemon-owned provider defaults and the optional cross-protocol translation endpoint. */
export class SessionStartOptionsResolver {
  constructor(
    private readonly providers: ProviderConfigStore,
    private readonly translator: TranslatorService | undefined,
  ) {}

  async resolve(options: StartOptions): Promise<StartOptions> {
    const resolved = applyProviderDefaults(
      options,
      this.providers.get(),
      this.providers.getAccounts(),
    );
    const upstream = translationUpstream(resolved);
    if (!upstream) return resolved;
    if (!this.translator) {
      throw new Error(
        'claude-code cross-protocol account needs the translation sidecar, which is unavailable',
      );
    }
    return withTranslatorEndpoint(resolved, await this.translator.ensure(upstream));
  }
}

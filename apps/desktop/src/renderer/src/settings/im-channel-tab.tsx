import type {
  ImChannelBindingView,
  ImChannelLinkOutcome,
  ImChannelPreferencesView,
} from '@linkcode/ui';
import { ImChannelSettingsPanel } from '@linkcode/ui';
import type { CloudImBinding, CloudImChat } from '@linkcode/workbench';
import {
  useCloudImActions,
  useCloudImBindings,
  useCloudImOverview,
  useCloudImPreferences,
} from '@linkcode/workbench';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useCloudAccount } from '../cloud-auth/use-cloud-account';

/** Container: cloud session gate + workbench IM data mapped into the business-free panel. */
export function ImChannelTab(): React.ReactNode {
  const cloudAuth = useCloudAccount();
  const signedIn = cloudAuth.account !== null;
  const accountKey = cloudAuth.account?.email ?? null;
  const overview = useCloudImOverview(accountKey);
  const linked = (overview.data?.accounts.length ?? 0) > 0;
  const bindings = useCloudImBindings(linked ? accountKey : null);
  const preferences = useCloudImPreferences(linked ? accountKey : null);
  const actions = useCloudImActions();

  const linkTelegram = async (code: string): Promise<ImChannelLinkOutcome> => {
    if (!actions) return 'error';
    try {
      const result = await actions.linkTelegram(code);
      if (result.ok) return 'linked';
      return result.reason;
    } catch {
      return 'error';
    }
  };

  const unlinkTelegram = async (): Promise<void> => {
    if (!actions) throw new Error('cloud IM source missing');
    await actions.unlinkTelegram();
  };

  const changePreferences = async (pref: ImChannelPreferencesView): Promise<void> => {
    if (!actions) throw new Error('cloud IM source missing');
    await actions.setPreferences(pref);
  };

  return (
    <ImChannelSettingsPanel
      signedIn={signedIn}
      onSignIn={cloudAuth.signIn}
      account={overview.data ? (overview.data.accounts.at(0) ?? null) : undefined}
      overviewError={
        overview.error === undefined
          ? null
          : (extractErrorMessage(overview.error, false) ?? String(overview.error))
      }
      chats={overview.data?.chats ?? []}
      bindings={
        overview.data?.accounts.length === 0
          ? []
          : bindings.data?.map((binding) => toBindingView(binding, overview.data?.chats))
      }
      botUsername={overview.data?.bot?.username ?? null}
      preferences={preferences.data}
      onLinkSubmit={linkTelegram}
      onUnlink={unlinkTelegram}
      onPreferencesChange={changePreferences}
    />
  );
}

function toBindingView(
  binding: CloudImBinding,
  chats: CloudImChat[] | undefined,
): ImChannelBindingView {
  return {
    sessionId: binding.sessionId,
    chatTitle: chats?.find((chat) => chat.chatId === binding.chatId)?.title ?? null,
    topicId: binding.topicId,
    state: binding.state,
    updatedAt: binding.updatedAt,
  };
}

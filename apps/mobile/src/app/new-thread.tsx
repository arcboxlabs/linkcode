import { useLinkCodeClient, useSessions } from '@linkcode/client-core';
import type { AgentKind, EffortLevel, SessionId } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import {
  AGENT_LABELS,
  EFFORT_OPTIONS_BY_ID,
  effortOptionsForModel,
  modelChoiceKey,
  repositoryLabel,
  resolveModel,
} from '@linkcode/ui/native';
import { Composer } from '@mobile/components/conversation/composer';
import { HostClientGate } from '@mobile/components/host/host-client-gate';
import { AgentSelectorChip, ApprovalChip } from '@mobile/components/host/new-thread/draft-tools';
import { ProjectRow } from '@mobile/components/host/new-thread/project-row';
import { VISIBLE_HEADER_OPTIONS } from '@mobile/components/shell/use-stack-screen-options';
import { queueInitialSessionPrompt } from '@mobile/runtime/initial-session-prompt';
import { buildStartOptions } from '@mobile/runtime/new-thread-start-options';
import { captureMobileProductEvent } from '@mobile/runtime/product-analytics';
import { useAccountModels } from '@mobile/runtime/use-account-models';
import { useAgentStartCatalog } from '@mobile/runtime/use-agent-start-catalog';
import { useWorkspaces } from '@mobile/runtime/use-workspaces';
import { Stack, useRouter } from 'expo-router';
import { noop } from 'foxact/noop';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useState } from 'react';
import { View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

/** Composer-first new-thread page, the mobile shape of the desktop draft surface: the start
 * options live inside the composer as menu chips — type the first message, send, and the thread
 * starts on the host with the prompt riding behind it. A root push, so it covers the tab bar. */
export default function NewThreadRoute(): React.ReactNode {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-background" style={{ paddingBottom: insets.bottom }}>
      {/* Title-less on purpose: the composer says everything, and the bare back chevron keeps
          the page reading as a sheet of options rather than a destination. */}
      <Stack.Screen options={{ ...VISIBLE_HEADER_OPTIONS, title: '' }} />
      <HostClientGate>
        <NewThreadScreen />
      </HostClientGate>
    </View>
  );
}

/** Explicit picks, each remembering the agent (and list) it was made for so a kind switch
 * invalidates them by derivation instead of effects. */
interface ModelPick {
  kind: AgentKind;
  key: string;
  id: string;
  accountId?: string;
  label: string;
}

function NewThreadScreen(): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const router = useRouter();
  const client = useLinkCodeClient();
  const { create } = useSessions();
  const { workspaces } = useWorkspaces();
  const [text, setText] = useState('');

  const [kind, setKind] = useState<AgentKind>(AgentKindSchema.options[0]);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState('');
  const [modelPick, setModelPick] = useState<ModelPick | null>(null);
  const [effortPick, setEffortPick] = useState<{ kind: AgentKind; effort: EffortLevel } | null>(
    null,
  );
  const [policyPick, setPolicyPick] = useState<{ kind: AgentKind; policyId: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Recency order mirrors the thread groups; the most recent project is the default pick.
  const ordered = [...workspaces].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  // eslint-disable-next-line vibe-proof/react-no-performance-impacting-array-find -- one lookup against a short workspace list; the Map the rule asks for costs the same walk to build each render
  const pickedWorkspace = ordered.find((workspace) => workspace.cwd === selectedCwd);
  const selectedWorkspace = pickedWorkspace ?? ordered.at(0);
  const cwd = selectedWorkspace?.cwd ?? null;

  const target = cwd ?? customPath.trim();
  const catalog = useAgentStartCatalog(kind, target || null);
  const models = useAccountModels(kind);

  // Desktop draft rules apply throughout: every catalog default is a display value; only an
  // explicit pick survives to the wire, and a pick made for another agent never leaks over.
  const pickedModel = modelPick?.kind === kind ? modelPick : null;
  const headModel = models?.at(0);

  // Effort follows the model the session will actually run on; the axis stays truthful even
  // when nothing here is offered.
  const effortModelId = pickedModel?.id ?? headModel?.id ?? catalog?.defaultModel ?? null;
  const catalogModel = resolveModel(catalog?.models, effortModelId);
  const effortOptions = effortOptionsForModel(kind, catalogModel);
  const pickedEffort = effortPick?.kind === kind ? effortPick.effort : null;
  const constrainedEffort =
    pickedEffort !== null && effortOptions?.some((option) => option.id === pickedEffort)
      ? pickedEffort
      : null;
  // A catalog effort paired with a default model belongs to that model; once something else picks
  // the model, that model's own advertised default is the honest value.
  const catalogEffort =
    catalog?.defaultModel === undefined || catalog.defaultModel === effortModelId
      ? catalog?.defaultEffort
      : catalogModel?.defaultEffort;
  const displayedEffort =
    constrainedEffort ??
    (catalogEffort !== undefined && effortOptions?.some((option) => option.id === catalogEffort)
      ? catalogEffort
      : null);

  // The selector chip reads like the desktop trigger: the running model plus its effort (short
  // form — chip width is precious), or the harness name while no account backs a model list.
  const displayedModelLabel = pickedModel?.label ?? headModel?.label ?? catalog?.defaultModel;
  const selectorValue = [
    displayedModelLabel ?? AGENT_LABELS[kind],
    ...(displayedEffort ? [EFFORT_OPTIONS_BY_ID[displayedEffort].shortLabel] : []),
  ].join(' · ');

  const policies = catalog?.policies ?? [];
  const pickedPolicyId =
    policyPick?.kind === kind && policies.some((policy) => policy.policyId === policyPick.policyId)
      ? policyPick.policyId
      : null;
  const displayedPolicyId =
    pickedPolicyId ?? catalog?.defaultPolicyId ?? policies.at(0)?.policyId ?? null;
  // eslint-disable-next-line vibe-proof/react-no-performance-impacting-array-find -- one lookup against a handful of policies per render
  const displayedPolicy = policies.find((policy) => policy.policyId === displayedPolicyId);
  const policyValue = displayedPolicy?.name ?? t('defaultOption');

  const onModelKeyChange = (key: string | null): void => {
    if (key === null) {
      setModelPick(null);
      return;
    }
    const option = models?.find((model) => modelChoiceKey(model) === key);
    if (option) {
      setModelPick({ kind, key, id: option.id, accountId: option.accountId, label: option.label });
    }
  };

  const onEffortChange = (value: string | null): void => {
    const option = effortOptions?.find((candidate) => candidate.id === value);
    setEffortPick(option ? { kind, effort: option.id } : null);
  };

  const onPolicyIdChange = (policyId: string | null): void => {
    setPolicyPick(policyId === null ? null : { kind, policyId });
  };

  const start = async (text: string) => {
    if (!target || creating) return;
    const startedAt = Date.now();
    setCreating(true);
    setCreateError(null);
    try {
      let sessionId: SessionId;
      try {
        sessionId = await create(
          buildStartOptions(kind, target, {
            model: pickedModel,
            effort: constrainedEffort,
            approvalPolicyId: pickedPolicyId,
          }),
        );
        captureMobileProductEvent('thread created', {
          agent_kind: kind,
          duration_ms: Date.now() - startedAt,
        });
      } catch (error) {
        captureMobileProductEvent('thread create failed', {
          agent_kind: kind,
          duration_ms: Date.now() - startedAt,
        });
        throw error;
      }
      queueInitialSessionPrompt(client, sessionId, text);
      router.replace(`/session/${sessionId}`);
    } catch (error) {
      setCreateError(extractErrorMessage(error, false) ?? 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <View className="flex-1" />
      <KeyboardStickyView>
        {/* Context sits outside the true composer as its own frame segment, like the web
            composer's context bar. */}
        <ProjectRow
          workspaces={ordered}
          workspaceLabel={
            selectedWorkspace
              ? (selectedWorkspace.name ?? repositoryLabel(selectedWorkspace.cwd))
              : t('projectLabel')
          }
          cwd={cwd}
          onCwdChange={setSelectedCwd}
          customPath={customPath}
          onCustomPathChange={setCustomPath}
        />
        <Composer
          onSend={(text) => {
            void start(text);
          }}
          onStop={noop}
          isRunning={false}
          disabled={creating}
          sendBlocked={target.length === 0}
          text={text}
          onTextChange={setText}
          error={createError ? t('createError', { error: createError }) : undefined}
          tools={
            <ApprovalChip
              policies={policies}
              policyId={pickedPolicyId}
              policyValue={policyValue}
              onPolicyIdChange={onPolicyIdChange}
            />
          }
          trailing={
            <AgentSelectorChip
              kind={kind}
              onKindChange={setKind}
              models={models}
              modelKey={pickedModel?.key ?? null}
              onModelKeyChange={onModelKeyChange}
              selectorValue={selectorValue}
              effortOptions={effortOptions}
              effort={constrainedEffort}
              onEffortChange={onEffortChange}
            />
          }
        />
      </KeyboardStickyView>
    </>
  );
}

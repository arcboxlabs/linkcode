import { Host, Menu, Picker, Text as UIText } from '@expo/ui/swift-ui';
import { tag } from '@expo/ui/swift-ui/modifiers';
import { AgentIcon, groupModelsByProvider, modelChoiceKey } from '@linkcode/ui/native';
import { OptionChip } from '@mobile/components/conversation/option-chip.ios';
import type {
  SessionApprovalChipProps,
  SessionSelectorChipProps,
} from '@mobile/components/conversation/session-tools.types';
import { useThemeColor } from 'heroui-native';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

/** The live session's approval chip: a ghost shield opening the adapter-advertised policy menu.
 * Absent state means the adapter has no switchable policies, so nothing renders. Selection is
 * server-reflected — the checkmark moves once `approval-policy-update` echoes the switch. */
export function SessionApprovalChip({
  approvalPolicy,
  onPolicyChange,
}: SessionApprovalChipProps): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  if (!approvalPolicy || approvalPolicy.availablePolicies.length === 0) return null;

  // eslint-disable-next-line sukka/react-no-performance-impacting-array-find -- one lookup against a handful of policies per render
  const current = approvalPolicy.availablePolicies.find(
    (policy) => policy.policyId === approvalPolicy.currentPolicyId,
  );
  return (
    <Host matchContents>
      <OptionChip
        sf="shield"
        label={t('approvalLabel')}
        value={current?.name ?? approvalPolicy.currentPolicyId}
        iconOnly
      >
        <Picker selection={approvalPolicy.currentPolicyId} onSelectionChange={onPolicyChange}>
          {approvalPolicy.availablePolicies.map((policy) => (
            <UIText key={policy.policyId} modifiers={[tag(policy.policyId)]}>
              {policy.name}
            </UIText>
          ))}
        </Picker>
      </OptionChip>
    </Host>
  );
}

/** The live session's selector: the harness brand mark beside one menu with Model / Effort
 * submenus. No harness submenu (the agent is fixed) and no "Default" entries — a running session
 * is always on a concrete value, and the checkmarks follow the `model-update` / `effort-update`
 * echoes rather than any local pick. */
export function SessionSelectorChip({
  kind,
  selectorValue,
  models,
  currentModelKey,
  onModelChange,
  effortOptions,
  currentEffort,
  onEffortChange,
}: SessionSelectorChipProps): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const muted = useThemeColor('muted');
  const hasModels = models !== null && models.length > 0;
  const hasEfforts = effortOptions !== undefined && effortOptions.length > 0;
  if (!hasModels && !hasEfforts) return null;

  // The account label joins a row only when the list spans several accounts — the same threshold
  // as the web's provider grouping; a single-account list repeating its account is noise.
  const spansAccounts = models !== null && groupModelsByProvider(models) !== null;

  return (
    <View className="flex-row items-center">
      {/* Footnote's 13pt metric, so the mark scales with the chip text beside it. */}
      <AgentIcon kind={kind} variant="ghost" size={13} color={muted} />
      <Host matchContents>
        {/* Keyed by menu shape: children added to an already-created Menu never reach the
            native UIMenu, so late-loading models/efforts must remount the chip. */}
        <OptionChip
          key={`${kind} ${models?.length ?? 0} ${effortOptions?.length ?? 0}`}
          label={t('modelLabel')}
          value={selectorValue}
          maxValueWidth={150}
        >
          {hasModels ? (
            <Menu label={t('modelLabel')} systemImage="cpu">
              <Picker
                selection={currentModelKey ?? undefined}
                onSelectionChange={(key: string) => {
                  const option = models.find((model) => modelChoiceKey(model) === key);
                  if (option) onModelChange(option);
                }}
              >
                {models.map((model) => (
                  <UIText key={modelChoiceKey(model)} modifiers={[tag(modelChoiceKey(model))]}>
                    {spansAccounts && model.description
                      ? `${model.label} — ${model.description}`
                      : model.label}
                  </UIText>
                ))}
              </Picker>
            </Menu>
          ) : null}
          {hasEfforts ? (
            <Menu label={t('effortLabel')} systemImage="gauge">
              <Picker
                selection={currentEffort ?? undefined}
                onSelectionChange={(value: string) => {
                  const option = effortOptions.find((candidate) => candidate.id === value);
                  if (option) onEffortChange(option.id);
                }}
              >
                {effortOptions.map((option) => (
                  <UIText key={option.id} modifiers={[tag(option.id)]}>
                    {option.label}
                  </UIText>
                ))}
              </Picker>
            </Menu>
          ) : null}
        </OptionChip>
      </Host>
    </View>
  );
}

import { Host, Menu, Picker, Text as UIText } from '@expo/ui/swift-ui';
import { tag } from '@expo/ui/swift-ui/modifiers';
import { AgentKindSchema } from '@linkcode/schema';
import {
  AGENT_LABELS,
  AgentIcon,
  groupModelsByProvider,
  modelChoiceKey,
} from '@linkcode/ui/native';
import { OptionChip } from '@mobile/components/conversation/option-chip.ios';
import type {
  AgentSelectorChipProps,
  ApprovalChipProps,
} from '@mobile/components/host/new-thread/draft-tools.types';
import { clearable, DEFAULT_TAG } from '@mobile/components/host/new-thread/draft-tools.types';
import { useThemeColor } from 'heroui-native';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

/** The draft's approval-policy chip: a ghost shield opening the policy menu. */
export function ApprovalChip({
  policies,
  policyId,
  policyValue,
  onPolicyIdChange,
}: ApprovalChipProps): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  if (policies.length === 0) return null;

  return (
    <Host matchContents>
      <OptionChip sf="shield" label={t('approvalLabel')} value={policyValue} iconOnly>
        <Picker selection={policyId ?? DEFAULT_TAG} onSelectionChange={clearable(onPolicyIdChange)}>
          <UIText modifiers={[tag(DEFAULT_TAG)]}>{t('defaultOption')}</UIText>
          {policies.map((policy) => (
            <UIText key={policy.policyId} modifiers={[tag(policy.policyId)]}>
              {policy.name}
            </UIText>
          ))}
        </Picker>
      </OptionChip>
    </Host>
  );
}

/** The draft's combined selector: the harness brand mark beside one menu with Agent / Model /
 * Effort submenus, mirroring the desktop `ModelSelectorMenu`. The brand mark is an RN view and
 * cannot enter the SwiftUI tree, so it sits flush beside the menu trigger — ghost styling makes
 * the pair read as one control. */
export function AgentSelectorChip({
  kind,
  onKindChange,
  models,
  modelKey,
  onModelKeyChange,
  selectorValue,
  effortOptions,
  effort,
  onEffortChange,
}: AgentSelectorChipProps): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const muted = useThemeColor('muted');
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
          key={`${kind} ${models === null ? 'x' : models.length} ${effortOptions?.length ?? 0}`}
          label={t('modelLabel')}
          value={selectorValue}
          maxValueWidth={150}
        >
          <Menu label={t('kindLabel')} systemImage="sparkles">
            <Picker selection={kind} onSelectionChange={onKindChange}>
              {AgentKindSchema.options.map((option) => (
                <UIText key={option} modifiers={[tag(option)]}>
                  {AGENT_LABELS[option]}
                </UIText>
              ))}
            </Picker>
          </Menu>
          {/* A labeled submenu, not an inline group: a bare Picker between sibling menus drops
              out of the native UIMenu entirely. */}
          {models !== null && models.length > 0 ? (
            <Menu label={t('modelLabel')} systemImage="cpu">
              <Picker
                selection={modelKey ?? DEFAULT_TAG}
                onSelectionChange={clearable(onModelKeyChange)}
              >
                <UIText modifiers={[tag(DEFAULT_TAG)]}>{t('defaultOption')}</UIText>
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
          {effortOptions !== undefined && effortOptions.length > 0 ? (
            <Menu label={t('effortLabel')} systemImage="gauge">
              <Picker
                selection={effort ?? DEFAULT_TAG}
                onSelectionChange={clearable(onEffortChange)}
              >
                <UIText modifiers={[tag(DEFAULT_TAG)]}>{t('defaultOption')}</UIText>
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

import { AgentIcon, groupModelsByProvider, modelChoiceKey } from '@linkcode/ui/native';
import type {
  SessionApprovalChipProps,
  SessionSelectorChipProps,
} from '@mobile/components/conversation/session-tools.types';
import { ToolChip } from '@mobile/components/conversation/tool-chip.android';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import type { SheetPickerSection } from '@mobile/components/form/sheet-picker.android';
import { SheetPicker } from '@mobile/components/form/sheet-picker.android';
import { ShieldIcon } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

/** The live session's approval chip on Android. Selection is server-reflected — the radio moves
 * once `approval-policy-update` echoes the switch, so a rejected switch just leaves the old
 * value showing. */
export function SessionApprovalChip({
  approvalPolicy,
  onPolicyChange,
}: SessionApprovalChipProps): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const [open, setOpen] = useState(false);
  if (!approvalPolicy || approvalPolicy.availablePolicies.length === 0) return null;

  // eslint-disable-next-line vibe-proof/react-no-performance-impacting-array-find -- one lookup against a handful of policies per render
  const current = approvalPolicy.availablePolicies.find(
    (policy) => policy.policyId === approvalPolicy.currentPolicyId,
  );

  return (
    <>
      <ToolChip
        icon={ShieldIcon}
        label={t('approvalLabel')}
        value={current?.name ?? approvalPolicy.currentPolicyId}
        iconOnly
        onPress={() => setOpen(true)}
      />
      <SheetPicker
        open={open}
        onClose={() => setOpen(false)}
        sections={[
          {
            id: 'policy',
            title: t('approvalLabel'),
            selection: approvalPolicy.currentPolicyId,
            options: approvalPolicy.availablePolicies.map((policy) => ({
              id: policy.policyId,
              label: policy.name,
            })),
            onSelect: onPolicyChange,
          },
        ]}
      />
    </>
  );
}

/** The live session's selector on Android: Model / Effort sections, no harness section (the agent
 * is fixed) and no "Default" entries — a running session is always on a concrete value. */
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
  const colors = useAppMaterialColors();
  const [open, setOpen] = useState(false);
  const hasModels = models !== null && models.length > 0;
  const hasEfforts = effortOptions !== undefined && effortOptions.length > 0;
  if (!hasModels && !hasEfforts) return null;

  // The account label joins a row only when the list spans several accounts — the same threshold
  // as the web's provider grouping; a single-account list repeating its account is noise.
  const spansAccounts = models !== null && groupModelsByProvider(models) !== null;

  const sections: SheetPickerSection[] = [];
  if (hasModels) {
    sections.push({
      id: 'model',
      title: t('modelLabel'),
      selection: currentModelKey,
      options: models.map((model) => ({
        id: modelChoiceKey(model),
        label:
          spansAccounts && model.description
            ? `${model.label} — ${model.description}`
            : model.label,
      })),
      onSelect(key) {
        const option = models.find((model) => modelChoiceKey(model) === key);
        if (option) onModelChange(option);
      },
    });
  }
  if (hasEfforts) {
    sections.push({
      id: 'effort',
      title: t('effortLabel'),
      selection: currentEffort,
      options: effortOptions.map((option) => ({ id: option.id, label: option.label })),
      onSelect(value) {
        const option = effortOptions.find((candidate) => candidate.id === value);
        if (option) onEffortChange(option.id);
      },
    });
  }

  return (
    <View className="flex-row items-center">
      {/* Footnote's 13pt metric, so the mark scales with the chip text beside it. */}
      <AgentIcon kind={kind} variant="ghost" size={13} color={colors.onSurfaceVariant} />
      <ToolChip
        label={t('modelLabel')}
        value={selectorValue}
        maxValueWidth={150}
        onPress={() => setOpen(true)}
      />
      <SheetPicker open={open} onClose={() => setOpen(false)} sections={sections} />
    </View>
  );
}

import { AgentKindSchema } from '@linkcode/schema';
import {
  AGENT_LABELS,
  AgentIcon,
  groupModelsByProvider,
  modelChoiceKey,
} from '@linkcode/ui/native';
import { ToolChip } from '@mobile/components/conversation/tool-chip.android';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import type { SheetPickerSection } from '@mobile/components/form/sheet-picker.android';
import { SheetPicker } from '@mobile/components/form/sheet-picker.android';
import type {
  AgentSelectorChipProps,
  ApprovalChipProps,
} from '@mobile/components/host/new-thread/draft-tools.types';
import { clearable, DEFAULT_TAG } from '@mobile/components/host/new-thread/draft-tools.types';
import { ShieldIcon } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

/** The draft's approval-policy chip on Android: a ghost shield opening the policy sheet. */
export function ApprovalChip({
  policies,
  policyId,
  policyValue,
  onPolicyIdChange,
}: ApprovalChipProps): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const [open, setOpen] = useState(false);
  if (policies.length === 0) return null;

  return (
    <>
      <ToolChip
        icon={ShieldIcon}
        label={t('approvalLabel')}
        value={policyValue}
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
            selection: policyId ?? DEFAULT_TAG,
            options: [
              { id: DEFAULT_TAG, label: t('defaultOption') },
              ...policies.map((policy) => ({ id: policy.policyId, label: policy.name })),
            ],
            onSelect: clearable(onPolicyIdChange),
          },
        ]}
      />
    </>
  );
}

/** The draft's combined selector on Android: the harness brand mark beside one chip opening a
 * sheet with Agent / Model / Effort sections — the same groups the iOS UIMenu nests as submenus,
 * flattened because bottom sheets don't nest. */
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
  const colors = useAppMaterialColors();
  const [open, setOpen] = useState(false);
  // The account label joins a row only when the list spans several accounts — the same threshold
  // as the web's provider grouping; a single-account list repeating its account is noise.
  const spansAccounts = models !== null && groupModelsByProvider(models) !== null;

  const sections: SheetPickerSection[] = [
    {
      id: 'kind',
      title: t('kindLabel'),
      selection: kind,
      options: AgentKindSchema.options.map((option) => ({
        id: option,
        label: AGENT_LABELS[option],
      })),
      onSelect(id) {
        const parsed = AgentKindSchema.safeParse(id);
        if (parsed.success) onKindChange(parsed.data);
      },
    },
  ];
  if (models !== null && models.length > 0) {
    sections.push({
      id: 'model',
      title: t('modelLabel'),
      selection: modelKey ?? DEFAULT_TAG,
      options: [
        { id: DEFAULT_TAG, label: t('defaultOption') },
        ...models.map((model) => ({
          id: modelChoiceKey(model),
          label:
            spansAccounts && model.description
              ? `${model.label} — ${model.description}`
              : model.label,
        })),
      ],
      onSelect: clearable(onModelKeyChange),
    });
  }
  if (effortOptions !== undefined && effortOptions.length > 0) {
    sections.push({
      id: 'effort',
      title: t('effortLabel'),
      selection: effort ?? DEFAULT_TAG,
      options: [
        { id: DEFAULT_TAG, label: t('defaultOption') },
        ...effortOptions.map((option) => ({ id: option.id, label: option.label })),
      ],
      onSelect: clearable(onEffortChange),
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

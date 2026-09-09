import {
  Column,
  FilterChip,
  FlowRow,
  Icon,
  ListItem,
  ModalBottomSheet,
  Text,
} from '@expo/ui/jetpack-compose';
import {
  animateContentSize,
  fillMaxWidth,
  padding,
  selectable,
  selectableGroup,
  verticalScroll,
} from '@expo/ui/jetpack-compose/modifiers';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import type {
  SelectorChipAxis,
  SelectorModelAxis,
} from '@mobile/components/form/selector-sheet.types';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import checkGlyph from '../../../assets/icons/check.xml';

function AxisTitle({ children }: { children: string }): React.ReactNode {
  const colors = useAppMaterialColors();
  return (
    <Text
      style={{ typography: 'titleSmall' }}
      color={colors.primary}
      modifiers={[padding(16, 12, 16, 4)]}
    >
      {children}
    </Text>
  );
}

/** Single-select chip set for a compact axis (harness, effort). The M3 filter chip draws no
 * checkmark of its own, so the selected chip supplies one as its leading icon. */
function ChipAxisSection({
  axis,
  onPicked,
}: {
  axis: SelectorChipAxis;
  /** Runs after a chip selection; the harness axis omits it to keep the sheet open. */
  onPicked?: () => void;
}): React.ReactNode {
  return (
    <Column>
      <AxisTitle>{axis.title}</AxisTitle>
      <FlowRow
        horizontalArrangement={{ spacedBy: 8 }}
        verticalArrangement={{ spacedBy: 8 }}
        modifiers={[fillMaxWidth(), padding(16, 4, 16, 4)]}
      >
        {axis.options.map((option) => {
          const selected = axis.selection === option.id;
          return (
            <FilterChip
              key={option.id}
              selected={selected}
              onClick={() => {
                axis.onSelect(option.id);
                onPicked?.();
              }}
              modifiers={[animateContentSize()]}
            >
              {selected ? (
                <FilterChip.LeadingIcon>
                  <Icon source={checkGlyph} size={18} />
                </FilterChip.LeadingIcon>
              ) : null}
              <FilterChip.Label>
                <Text>{option.label}</Text>
              </FilterChip.Label>
            </FilterChip>
          );
        })}
      </FlowRow>
    </Column>
  );
}

/** The harness/model/effort picker on Android — the MD3 shape of the web `ModelSelectorMenu`:
 * one modal bottom sheet with chip sets for the compact axes and a grouped list for models.
 * Picking a harness keeps the sheet open (it re-scopes the axes below); picking a model or an
 * effort is terminal and closes, matching the other platforms. */
export function SelectorSheet({
  open,
  onClose,
  harness,
  model,
  effort,
}: {
  open: boolean;
  onClose: () => void;
  /** Draft-only harness chips; absent on a live session where the agent is fixed. */
  harness?: SelectorChipAxis;
  model?: SelectorModelAxis;
  effort?: SelectorChipAxis;
}): React.ReactNode {
  const colors = useAppMaterialColors();

  if (!open) return null;

  return (
    <ThemedHost style={{ position: 'absolute' }} pointerEvents="box-none">
      <ModalBottomSheet onDismissRequest={onClose}>
        <Column modifiers={[verticalScroll(), padding(0, 0, 0, 16), animateContentSize()]}>
          {harness === undefined ? null : <ChipAxisSection axis={harness} />}
          {model === undefined ? null : (
            <Column modifiers={[selectableGroup()]}>
              <AxisTitle>{model.title}</AxisTitle>
              {model.groups.map((group) => (
                <Column key={group.label ?? ''}>
                  {group.label === null ? null : (
                    <Text
                      style={{ typography: 'labelMedium' }}
                      color={colors.onSurfaceVariant}
                      modifiers={[padding(16, 10, 16, 0)]}
                    >
                      {group.label}
                    </Text>
                  )}
                  {group.options.map((option) => (
                    <ListItem
                      key={option.id}
                      colors={{ containerColor: '#00000000' }}
                      modifiers={[
                        selectable(
                          model.selection === option.id,
                          () => {
                            model.onSelect(option.id);
                            onClose();
                          },
                          'radioButton',
                        ),
                      ]}
                    >
                      <ListItem.HeadlineContent>
                        <Text>{option.label}</Text>
                      </ListItem.HeadlineContent>
                      {model.selection === option.id ? (
                        <ListItem.TrailingContent>
                          <Icon source={checkGlyph} size={24} tint={colors.primary} />
                        </ListItem.TrailingContent>
                      ) : null}
                    </ListItem>
                  ))}
                </Column>
              ))}
            </Column>
          )}
          {effort === undefined ? null : <ChipAxisSection axis={effort} onPicked={onClose} />}
        </Column>
      </ModalBottomSheet>
    </ThemedHost>
  );
}

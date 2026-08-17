import {
  Column,
  Host,
  ListItem,
  ModalBottomSheet,
  RadioButton,
  Text,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import { clickable, padding, verticalScroll } from '@expo/ui/jetpack-compose/modifiers';

export interface SheetPickerOption {
  id: string;
  label: string;
  hint?: string;
}

export interface SheetPickerSection {
  id: string;
  title?: string;
  /** Option id drawn as selected, or null for none. */
  selection: string | null;
  options: SheetPickerOption[];
  onSelect: (id: string) => void;
}

export interface SheetPickerAction {
  id: string;
  label: string;
  onPress: () => void;
}

const NO_ACTIONS: SheetPickerAction[] = [];

/** MD3 bottom-sheet radio picker — the Android stand-in for every UIMenu-style selector (the
 * Compose DropdownMenu has no submenus and no built-in trigger). Selecting closes the sheet;
 * `actions` render below the sections as plain rows. */
export function SheetPicker({
  open,
  onClose,
  sections,
  actions = NO_ACTIONS,
}: {
  open: boolean;
  onClose: () => void;
  sections: SheetPickerSection[];
  actions?: SheetPickerAction[];
}): React.ReactNode {
  const colors = useMaterialColors();

  if (!open) return null;

  return (
    <Host style={{ position: 'absolute' }} pointerEvents="box-none">
      <ModalBottomSheet onDismissRequest={onClose}>
        <Column modifiers={[verticalScroll(), padding(0, 0, 0, 16)]}>
          {sections.map((section) => (
            <Column key={section.id}>
              {section.title === undefined ? null : (
                <Text
                  style={{ typography: 'titleSmall' }}
                  color={colors.primary}
                  modifiers={[padding(16, 12, 16, 4)]}
                >
                  {section.title}
                </Text>
              )}
              {section.options.map((option) => (
                <ListItem
                  key={option.id}
                  colors={{ containerColor: '#00000000' }}
                  modifiers={[
                    clickable(() => {
                      section.onSelect(option.id);
                      onClose();
                    }),
                  ]}
                >
                  <ListItem.LeadingContent>
                    <RadioButton selected={section.selection === option.id} />
                  </ListItem.LeadingContent>
                  <ListItem.HeadlineContent>
                    <Text>{option.label}</Text>
                  </ListItem.HeadlineContent>
                  {option.hint === undefined ? null : (
                    <ListItem.SupportingContent>
                      <Text style={{ typography: 'bodySmall' }} color={colors.onSurfaceVariant}>
                        {option.hint}
                      </Text>
                    </ListItem.SupportingContent>
                  )}
                </ListItem>
              ))}
            </Column>
          ))}
          {actions.map((action) => (
            <ListItem
              key={action.id}
              colors={{ containerColor: '#00000000' }}
              modifiers={[
                clickable(() => {
                  action.onPress();
                  onClose();
                }),
              ]}
            >
              <ListItem.HeadlineContent>
                <Text>{action.label}</Text>
              </ListItem.HeadlineContent>
            </ListItem>
          ))}
        </Column>
      </ModalBottomSheet>
    </Host>
  );
}

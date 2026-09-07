import { HStack, Image, Menu, Text } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { Color } from 'expo-router';
import type { SFSymbol } from 'sf-symbols-typescript';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const CHIP_FONT = font({ textStyle: 'footnote' });
/** SwiftUI draws a Menu label with the accent tint, and hierarchical styles derive from it —
 * re-tinting to the label color makes the secondary style read as gray, not light blue. */
const LABEL_TINT = tint(Color.ios.label);

/** One composer tool: a ghost chip opening a native `UIMenu` — the web composer's footer buttons
 * at touch size, without a fill. The `label` names the chip for accessibility only. */
export function OptionChip({
  sf,
  label,
  value,
  iconOnly = false,
  maxValueWidth,
  children,
}: {
  /** Optional SF symbol; omit when an RN brand icon sits beside the chip instead. */
  sf?: SFSymbol;
  /** Accessibility name of the chip ("Model"); not rendered. */
  label: string;
  /** Resolved current value — rendered unless `iconOnly`, always spoken. */
  value: string;
  /** Icon-size the chip (the shield); the value still reaches accessibility. */
  iconOnly?: boolean;
  /** Cap for long values so one chip cannot push the send button out. */
  maxValueWidth?: number;
  /** Menu items: `Picker` / `Button` / `Section` / `Divider` / nested `Menu`. */
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <Menu
      modifiers={[LABEL_TINT]}
      label={
        <HStack
          spacing={5}
          modifiers={[
            accessibilityLabel(`${label}: ${value}`),
            padding({ horizontal: 6, vertical: 8 }),
            frame({ minWidth: 44, minHeight: 44 }),
          ]}
        >
          {sf ? <Image systemName={sf} size={15} modifiers={[SECONDARY]} /> : null}
          {iconOnly ? null : (
            <Text
              modifiers={[
                CHIP_FONT,
                SECONDARY,
                lineLimit(1),
                ...(maxValueWidth === undefined ? [] : [frame({ maxWidth: maxValueWidth })]),
              ]}
            >
              {value}
            </Text>
          )}
        </HStack>
      }
    >
      {children}
    </Menu>
  );
}

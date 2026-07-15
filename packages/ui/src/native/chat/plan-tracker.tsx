import type { Plan } from '@linkcode/schema';
import { Spinner } from 'heroui-native';
import { Check, ChevronRight, Circle } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle as SvgCircle } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';
import { useTranslations } from 'use-intl';

const RING_SIZE = 18;
const RING_STROKE = 2.5;

function ProgressRing({ completed, total }: { completed: number; total: number }): React.ReactNode {
  const [borderColor, successColor] = useCSSVariable(['--border', '--success']);
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = total > 0 ? completed / total : 0;

  return (
    <Svg width={RING_SIZE} height={RING_SIZE}>
      <SvgCircle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={radius}
        stroke={String(borderColor)}
        strokeWidth={RING_STROKE}
        fill="none"
      />
      <SvgCircle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={radius}
        stroke={String(successColor)}
        strokeWidth={RING_STROKE}
        fill="none"
        strokeDasharray={`${circumference * fraction} ${circumference}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
      />
    </Svg>
  );
}

export interface PlanTrackerProps {
  plan: Plan;
}

/**
 * Desktop `StepPromptRow` equivalent: a collapsed `Step N/M · current entry` row with a
 * progress ring, expanding in place to the full entry list.
 */
export function PlanTracker({ plan }: PlanTrackerProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const [expanded, setExpanded] = useState(false);
  const [mutedColor, successColor] = useCSSVariable(['--muted', '--success']);

  const entries = plan.entries;
  if (entries.length === 0) return null;
  const completed = entries.filter((entry) => entry.status === 'completed').length;
  const current =
    entries.find((entry) => entry.status === 'in_progress') ??
    entries.find((entry) => entry.status === 'pending');
  const done = completed === entries.length;

  return (
    <View className="rounded-xl border border-border bg-surface-secondary/50">
      <Pressable
        accessibilityRole="button"
        onPress={() => setExpanded((value) => !value)}
        className="min-h-11 flex-row items-center gap-2.5 px-3 py-2"
      >
        <ProgressRing completed={completed} total={entries.length} />
        <Text className="text-[12.5px] text-foreground" style={{ fontWeight: '600' }}>
          {t('stepLabel', {
            current: Math.min(completed + 1, entries.length),
            total: entries.length,
          })}
        </Text>
        <Text
          className={`flex-1 text-[12.5px] text-muted ${done ? 'line-through' : ''}`}
          numberOfLines={1}
        >
          {current?.content ?? entries.at(-1)?.content}
        </Text>
        <ChevronRight
          size={14}
          color={String(mutedColor)}
          style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
        />
      </Pressable>
      {expanded ? (
        <View className="gap-1.5 border-border border-t px-3 py-2">
          {entries.map((entry, index) => (
            <View
              // eslint-disable-next-line @eslint-react/no-array-index-key -- plan entries carry no id; plans replace wholesale
              key={index}
              className="flex-row items-center gap-2"
            >
              {entry.status === 'completed' ? (
                <Check size={13} color={String(successColor)} />
              ) : entry.status === 'in_progress' ? (
                <Spinner size="sm" color="warning" />
              ) : (
                <Circle size={12} color={String(mutedColor)} />
              )}
              <Text
                className={`flex-1 text-[12.5px] ${
                  entry.status === 'completed' ? 'text-muted line-through' : 'text-foreground'
                }`}
              >
                {entry.content}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

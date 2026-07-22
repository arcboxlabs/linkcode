import { ProgressPrimitive } from 'coss-ui/components/progress';
import { cn } from '../lib/cn';

const VIEW_BOX_SIZE = 16;

export type CircularProgressProps = Omit<
  React.ComponentProps<typeof ProgressPrimitive.Root>,
  'children' | 'max' | 'min' | 'value'
> & {
  value: number | null;
  min?: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  trackClassName?: string;
  indicatorClassName?: string;
};

export function CircularProgress({
  className,
  indicatorClassName,
  max = 100,
  min = 0,
  size,
  strokeWidth = 3,
  style,
  trackClassName,
  value,
  ...props
}: CircularProgressProps): React.ReactNode {
  const center = VIEW_BOX_SIZE / 2;
  const radius = Math.max(0, center - strokeWidth / 2);
  const circumference = 2 * Math.PI * radius;
  const percent = progressPercent(value, min, max);
  const dashOffset = circumference * (1 - percent / 100);
  const rootStyle = size === undefined ? style : { width: size, height: size, ...style };

  return (
    <ProgressPrimitive.Root
      className={cn('inline-block size-4 shrink-0 text-foreground', className)}
      data-slot="circular-progress"
      max={max}
      min={min}
      style={rootStyle}
      value={value}
      {...props}
    >
      <svg
        aria-hidden="true"
        className="block size-full"
        viewBox={`0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}`}
      >
        <circle
          className={cn('fill-none stroke-current opacity-25', trackClassName)}
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={strokeWidth}
        />
        <circle
          className={cn(
            'fill-none stroke-current transition-[stroke-dashoffset] duration-500',
            indicatorClassName,
          )}
          cx={center}
          cy={center}
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
    </ProgressPrimitive.Root>
  );
}

function progressPercent(value: number | null, min: number, max: number): number {
  if (max === min || value === null || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, ((value - min) * 100) / (max - min)));
}

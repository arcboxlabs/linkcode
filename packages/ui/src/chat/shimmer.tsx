import { motion } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../lib/cn';

export function Shimmer({
  children,
  className,
  duration = 1.6,
}: {
  children: ReactNode;
  className?: string;
  duration?: number;
}): ReactNode {
  return (
    <motion.span
      animate={{ backgroundPosition: '0% center' }}
      className={cn(
        'inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent',
        className,
      )}
      initial={{ backgroundPosition: '100% center' }}
      style={
        {
          backgroundImage:
            'linear-gradient(90deg, transparent 35%, var(--color-background), transparent 65%), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))',
          backgroundRepeat: 'no-repeat',
        } satisfies CSSProperties
      }
      transition={{ duration, ease: 'linear', repeat: Number.POSITIVE_INFINITY }}
    >
      {children}
    </motion.span>
  );
}

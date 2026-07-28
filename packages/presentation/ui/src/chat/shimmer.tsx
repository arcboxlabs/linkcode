import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { useRenderPrefs } from '../render-prefs';

export function Shimmer({
  children,
  className,
  duration = 1.6,
}: {
  children: React.ReactNode;
  className?: string;
  duration?: number;
}): React.ReactNode {
  // Reduce-motion drops the animated gradient sweep for a static muted label.
  if (useRenderPrefs().reduceMotion) {
    return <span className={cn('inline-block text-muted-foreground', className)}>{children}</span>;
  }

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
        } satisfies React.CSSProperties
      }
      transition={{ duration, ease: 'linear', repeat: Number.POSITIVE_INFINITY }}
    >
      {children}
    </motion.span>
  );
}

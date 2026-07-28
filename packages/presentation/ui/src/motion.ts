import type { Transition } from 'motion/react';

/** The product's one spring (duration-based, no bounce) — never inline ad-hoc spring params. */
export const SPRING = { type: 'spring', duration: 0.3, bounce: 0 } as const satisfies Transition;

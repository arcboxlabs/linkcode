import { AccordionTrigger } from 'coss-ui/components/accordion';

/**
 * Accordion trigger for the sidebar's top-level sections ("Projects" / "Chats"): coss-ui's
 * trigger restyled from its card geometry to `SidebarGroupLabel`'s row (h-8, text-xs, muted),
 * with the built-in chevron pulled next to the label. `-mt-0.5` counters the chevron's baked
 * `translate-y-0.5` (tuned for items-start) via margin, which can't lose a specificity race.
 */
export function SectionAccordionTrigger({ children }: React.PropsWithChildren): React.ReactNode {
  return (
    <AccordionTrigger className="*:data-[slot=accordion-indicator]:-mt-0.5 h-8 items-center justify-start gap-1 rounded-lg px-2 py-0 font-medium text-muted-foreground text-xs">
      {children}
    </AccordionTrigger>
  );
}

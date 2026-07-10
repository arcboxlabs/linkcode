import { AccordionTrigger } from 'coss-ui/components/accordion';

/**
 * Accordion trigger for the sidebar's top-level sections ("Projects" / "Chats"): coss-ui's
 * trigger restyled from its card geometry to the sidebar's h-8 row, with the built-in chevron
 * pulled next to the label and vertically centered.
 */
export function SectionAccordionTrigger({ children }: React.PropsWithChildren): React.ReactNode {
  return (
    <AccordionTrigger className="*:data-[slot=accordion-indicator]:translate-y-0 h-8 items-center justify-start gap-2 rounded-lg px-2 py-0 text-xs focus-visible:ring-1 focus-visible:ring-inset">
      {children}
    </AccordionTrigger>
  );
}

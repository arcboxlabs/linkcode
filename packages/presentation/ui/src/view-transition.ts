// @types/react tracks stable and lacks the canary-only `<ViewTransition>` export (CODE-457);
// this augmentation rides along wherever the component is imported through this module. The
// class props take a view-transition-class name; `'none'` disables that trigger. Drop the
// augmentation once @types/react ships the component.
declare module 'react' {
  export interface ViewTransitionProps {
    children?: import('react').ReactNode;
    /** Shared-element pair key: a boundary unmounting and one mounting under the same name
     * within one transition pair up. Omitted = auto (never pairs). */
    name?: string;
    default?: string;
    enter?: string;
    exit?: string;
    update?: string;
    share?: string;
  }

  export function ViewTransition(props: ViewTransitionProps): import('react').ReactNode;
}

export { ViewTransition, type ViewTransitionProps } from 'react';

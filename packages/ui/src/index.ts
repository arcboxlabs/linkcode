/**
 * @linkcode/ui — the shared Coss UI frontend for Link Code (PLAN §4.6).
 * Hosts the Coss UI primitives, the conversation rendering, the app shell, and the `Workbench` root that
 * both `apps/web` and `apps/desktop` mount. Apps import `@linkcode/ui/styles.css` for the design tokens.
 */
export { cn } from './lib/cn';
export * from './components/ui';
export * from './chat';
export * from './shell';
export * from './Workbench';

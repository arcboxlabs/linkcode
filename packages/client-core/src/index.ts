/**
 * @linkcode/client-core — the data layer shared across all three platforms
 * (docs/ARCHITECTURE.md#packages--repo-layout).
 * Data fetching / caching can be paired with TanStack Query / SWR on each platform; the event stream flows through the subscription hooks here.
 */
export * from './client';
export * from './conversation';
export * from './conversation-store';
export * from './react';

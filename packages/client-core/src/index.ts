/**
 * @linkcode/client-core — the data layer shared across all three platforms (PLAN §4.6).
 * Data fetching / caching can be paired with TanStack Query / SWR on each platform; the event stream flows through the subscription hooks here.
 */
export * from './client';
export * from './react';

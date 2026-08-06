/**
 * How an account reaches a provider, as one exhaustive axis rather than a set of optional fields
 * that can contradict each other. An account either pins one endpoint the user named, or leaves
 * the endpoint to be resolved per agent from the service catalog. Absent covers the accounts that
 * name no endpoint at all: a CLI login, or a pre-catalog bare key.
 */
export type ProviderAccountRouting =
  | { kind: 'pinned'; baseUrl: string; protocol: string }
  | { kind: 'catalog'; protocols: string[] };

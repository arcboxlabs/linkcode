export type PluginUnitCardStatus = 'disabled' | 'ready' | 'partial' | 'unavailable';
export type PluginServerCardStatus =
  | 'ready'
  | 'satisfied'
  | 'expired-credential'
  | 'unsatisfied-binding'
  | 'broker-unavailable';

export interface PluginServerCardView {
  name: string;
  /** Localized service display name, when the server depends on one. */
  serviceLabel?: string;
  status: PluginServerCardStatus;
}

export interface PluginUnitCardView {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  status: PluginUnitCardStatus;
  servers: PluginServerCardView[];
}

/** A user-imported MCP server, projected for display; env/header values never reach the client. */
export interface CustomServerCardView {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  enabled: boolean;
  /** command (stdio) or url (http). */
  detail: string;
  /** Configured env/header keys, masked — values are never present. */
  secretKeys: string[];
}

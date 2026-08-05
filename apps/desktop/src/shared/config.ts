import type { ConfigEmergencyState, ConfigValue } from '@linkcode/common/config';

export const CONFIG_HOT_UPDATE_CHANNEL = 'linkcode.config.hotUpdate';
export const CONFIG_REFRESH_CHANNEL = 'linkcode.config.refresh';
export const CONFIG_SNAPSHOT_CHANNEL = 'linkcode.config.snapshot';
export const CONFIG_SNAPSHOT_INFO_CHANNEL = 'linkcode.config.snapshotInfo';

export type EffectiveConfigSnapshot = Readonly<Record<string, ConfigValue>>;

export interface ConfigSnapshotInfo {
  readonly configVersion: string | null;
  readonly emergency: ConfigEmergencyState | null;
  readonly sha256: string | null;
  readonly source: 'bundled' | 'cache' | 'remote';
  readonly stagedColdKeys: readonly string[];
  readonly status: 'READY';
}

export type ConfigRefreshStatus = 'disabled' | 'error' | 'idempotent' | 'not-modified' | 'updated';

export interface ConfigRefreshReport {
  readonly emergency: ConfigRefreshStatus;
  readonly normal: ConfigRefreshStatus;
  readonly snapshotInfo: ConfigSnapshotInfo;
}

export interface ConfigBridge {
  readonly effectiveSnapshot: () => EffectiveConfigSnapshot;
  readonly snapshotInfo: () => ConfigSnapshotInfo;
  readonly refresh: () => Promise<ConfigRefreshReport>;
  readonly onHotUpdate: (callback: (keys: readonly string[]) => void) => () => void;
}

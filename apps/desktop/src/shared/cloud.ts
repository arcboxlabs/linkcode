/**
 * IPC channel for the renderer's `linkcodeCloud` bridge to list the signed-in account's online hosts.
 * The fetch itself runs in main (it holds the keychain session); the renderer never calls the cloud
 * API directly. Shared here so main and the dependency-light preload agree on the channel name.
 */
export const CLOUD_LIST_HOSTS_CHANNEL = 'linkcode.cloud.list-hosts';

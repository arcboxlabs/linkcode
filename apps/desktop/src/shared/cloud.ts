/**
 * IPC channels for the renderer's `linkcodeCloud` bridge. The fetches run in main (it holds the
 * keychain session); the renderer never calls the cloud API directly. Shared here so main and the
 * dependency-light preload agree on the channel names.
 */
export const CLOUD_LIST_HOSTS_CHANNEL = 'linkcode.cloud.list-hosts';

// IM Channel management (`/im/*` on the cloud API).
export const CLOUD_IM_OVERVIEW_CHANNEL = 'linkcode.cloud.im.overview';
export const CLOUD_IM_BINDINGS_CHANNEL = 'linkcode.cloud.im.bindings';
export const CLOUD_IM_LINK_TELEGRAM_CHANNEL = 'linkcode.cloud.im.link-telegram';
export const CLOUD_IM_UNLINK_TELEGRAM_CHANNEL = 'linkcode.cloud.im.unlink-telegram';
export const CLOUD_IM_CREATE_BINDING_CHANNEL = 'linkcode.cloud.im.create-binding';
export const CLOUD_IM_UPDATE_BINDING_CHANNEL = 'linkcode.cloud.im.update-binding';
export const CLOUD_IM_DELETE_BINDING_CHANNEL = 'linkcode.cloud.im.delete-binding';
export const CLOUD_IM_GET_PREFERENCES_CHANNEL = 'linkcode.cloud.im.get-preferences';
export const CLOUD_IM_SET_PREFERENCES_CHANNEL = 'linkcode.cloud.im.set-preferences';

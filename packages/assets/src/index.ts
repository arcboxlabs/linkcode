/**
 * @linkcode/assets — the daemon's managed-asset store (CODE-111): download, verify,
 * atomically install, and garbage-collect the platform binaries LinkCode provisions for
 * the user (agent CLI pairs, standalone toolchains). Consumed by the daemon only; clients
 * see assets through the wire contract in @linkcode/schema.
 */

export * from './catalog';
export * from './download';
export * from './errors';
export * from './extract';
export * from './gc';
export * from './install';
export * from './manager';
export * from './paths';
export * from './platform';
export * from './registry-client';
export * from './resolve';
export * from './sri';
export * from './version-pin';

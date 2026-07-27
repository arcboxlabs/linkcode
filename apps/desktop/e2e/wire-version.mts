/**
 * The wire-protocol version the simulator E2E harnesses speak, kept in one place so a bump cannot
 * land in one script and not the other.
 *
 * It is hand-maintained rather than imported from `@linkcode/schema` because these scripts run
 * under plain `node`, whose ESM resolver rejects the package's extensionless and directory-style
 * internal specifiers (`ERR_UNSUPPORTED_DIR_IMPORT` on `./model`) — the schema package is only
 * consumable through a bundler or tsc.
 *
 * **Bump this together with `WIRE_PROTOCOL_VERSION`** (`packages/foundation/schema/src/wire/message.ts`).
 * A stale value does not fail loudly: the socket still completes, then every frame is silently
 * discarded at the transport, so a driving script looks connected while the device never moves.
 */
export const WIRE_VERSION = 58;

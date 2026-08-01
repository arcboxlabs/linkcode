import { z } from 'zod';
import { agentWireVariants } from './agent';
import { agentCatalogWireVariants } from './agent-catalog';
import { agentLoginWireVariants } from './agent-login';
import { agentRuntimeWireVariants } from './agent-runtime';
import { artifactWireVariants } from './artifact';
import { browserWireVariants } from './browser';
import { configWireVariants } from './config';
import { fileWireVariants } from './file';
import { gitWireVariants } from './git';
import { historyWireVariants } from './history';
import { keepAliveWireVariants } from './keep-alive';
import { loopWireVariants } from './loop';
import { managedAssetWireVariants } from './managed-asset';
import { pluginWireVariants } from './plugin';
import { requestWireVariants } from './request';
import { resourceWireVariants } from './resource';
import { scheduleWireVariants } from './schedule';
import { scriptWireVariants } from './script';
import { sessionWireVariants } from './session';
import { simulatorWireVariants } from './simulator';
import { terminalWireVariants } from './terminal';
import { workspaceWireVariants } from './workspace';

const wirePayloadVariants = [
  ...sessionWireVariants,
  ...historyWireVariants,
  ...requestWireVariants,
  ...resourceWireVariants,
  ...configWireVariants,
  ...agentRuntimeWireVariants,
  ...agentCatalogWireVariants,
  ...agentLoginWireVariants,
  ...managedAssetWireVariants,
  ...pluginWireVariants,
  ...workspaceWireVariants,
  ...gitWireVariants,
  ...fileWireVariants,
  ...scriptWireVariants,
  ...scheduleWireVariants,
  ...loopWireVariants,
  ...artifactWireVariants,
  ...browserWireVariants,
  ...agentWireVariants,
  ...terminalWireVariants,
  ...simulatorWireVariants,
  ...keepAliveWireVariants,
] as const;

/** Envelope payload: every wire variant, discriminated by `kind`. */
export const WirePayloadSchema = z
  .discriminatedUnion('kind', wirePayloadVariants)
  .superRefine((payload, ctx) => {
    if (payload.kind !== 'config.set') return;
    const updates = [payload.providers, payload.accounts, payload.customMcpServers].filter(
      (value) => value !== undefined,
    ).length;
    if (updates > 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'config.set may update only one configuration resource',
      });
    }
  });
export type WirePayload = z.infer<typeof WirePayloadSchema>;

/** Every `kind` this build knows. A frame carrying anything else comes from a newer peer and is
 * dropped on its own, rather than failing the whole envelope. */
export const WIRE_PAYLOAD_KINDS: ReadonlySet<string> = new Set(
  wirePayloadVariants.map((variant) => variant.shape.kind.value),
);

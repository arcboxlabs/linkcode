import { z } from 'zod';
import { agentWireVariants } from './agent';
import { agentCatalogWireVariants } from './agent-catalog';
import { agentLoginWireVariants } from './agent-login';
import { agentRuntimeWireVariants } from './agent-runtime';
import { artifactWireVariants } from './artifact';
import { configWireVariants } from './config';
import { fileWireVariants } from './file';
import { gitWireVariants } from './git';
import { historyWireVariants } from './history';
import { keepAliveWireVariants } from './keep-alive';
import { loopWireVariants } from './loop';
import { managedAssetWireVariants } from './managed-asset';
import { requestWireVariants } from './request';
import { scheduleWireVariants } from './schedule';
import { scriptWireVariants } from './script';
import { sessionWireVariants } from './session';
import { simulatorWireVariants } from './simulator';
import { terminalWireVariants } from './terminal';
import { workspaceWireVariants } from './workspace';

/** Envelope payload: every wire variant, discriminated by `kind`. */
export const WirePayloadSchema = z.discriminatedUnion('kind', [
  ...sessionWireVariants,
  ...historyWireVariants,
  ...requestWireVariants,
  ...configWireVariants,
  ...agentRuntimeWireVariants,
  ...agentCatalogWireVariants,
  ...agentLoginWireVariants,
  ...managedAssetWireVariants,
  ...workspaceWireVariants,
  ...gitWireVariants,
  ...fileWireVariants,
  ...scriptWireVariants,
  ...scheduleWireVariants,
  ...loopWireVariants,
  ...artifactWireVariants,
  ...agentWireVariants,
  ...terminalWireVariants,
  ...simulatorWireVariants,
  ...keepAliveWireVariants,
]);
export type WirePayload = z.infer<typeof WirePayloadSchema>;

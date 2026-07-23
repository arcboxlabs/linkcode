import { z } from 'zod';
import { McpServerSchema } from './agent/input';
import { TimestampSchema } from './primitives';

export const McpPluginIdSchema = z.enum(['github-read']);
export type McpPluginId = z.infer<typeof McpPluginIdSchema>;

export const McpPluginServiceSchema = z.enum(['github']);
export type McpPluginService = z.infer<typeof McpPluginServiceSchema>;

export const McpPluginLabelKeySchema = z.enum(['units.githubRead.label']);
export const McpPluginDescriptionKeySchema = z.enum(['units.githubRead.description']);

export const McpPluginCredentialSlotSchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('env'), name: z.string().min(1) }),
  z.object({ target: z.literal('header'), name: z.string().min(1) }),
]);
export type McpPluginCredentialSlot = z.infer<typeof McpPluginCredentialSlotSchema>;

/** One MCP server inside a plugin. A plugin composes one or more servers; each server that needs a
 * credential names its service — the connector association is per service, never per plugin. */
export const McpPluginServerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('preset'),
    server: McpServerSchema,
    service: McpPluginServiceSchema.optional(),
    credentialSlots: z.array(McpPluginCredentialSlotSchema).default([]),
  }),
  z.object({
    type: z.literal('managed'),
    name: z.string().min(1),
    service: McpPluginServiceSchema,
  }),
]);
export type McpPluginServer = z.infer<typeof McpPluginServerSchema>;

export function mcpPluginServerName(server: McpPluginServer): string {
  return server.type === 'preset' ? server.server.name : server.name;
}

export const McpPluginDescriptorSchema = z
  .object({
    id: McpPluginIdSchema,
    labelKey: McpPluginLabelKeySchema,
    descriptionKey: McpPluginDescriptionKeySchema,
    servers: z.array(McpPluginServerSchema).min(1),
  })
  .superRefine((descriptor, context) => {
    const names = new Set<string>();
    for (const entry of descriptor.servers) {
      const name = mcpPluginServerName(entry);
      if (names.has(name)) {
        context.addIssue({ code: 'custom', message: `duplicate MCP server name: ${name}` });
      }
      names.add(name);
      if (entry.type !== 'preset') continue;
      if (entry.credentialSlots.length > 0 && entry.service === undefined) {
        context.addIssue({ code: 'custom', message: 'credential slots require a service' });
      }
      const target = entry.server.type === 'stdio' ? 'env' : 'header';
      for (const slot of entry.credentialSlots) {
        if (slot.target !== target) {
          context.addIssue({
            code: 'custom',
            message: `${entry.server.type} MCP cannot inject a ${slot.target} credential`,
          });
        }
      }
    }
  });
export type McpPluginDescriptor = z.infer<typeof McpPluginDescriptorSchema>;

export const McpPluginCatalogSchema = z
  .array(McpPluginDescriptorSchema)
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const descriptor of catalog) {
      if (ids.has(descriptor.id)) {
        context.addIssue({ code: 'custom', message: `duplicate plugin id: ${descriptor.id}` });
      }
      ids.add(descriptor.id);
      for (const entry of descriptor.servers) {
        const name = mcpPluginServerName(entry);
        if (names.has(name)) {
          context.addIssue({ code: 'custom', message: `duplicate MCP server name: ${name}` });
        }
        names.add(name);
      }
    }
  });
export type McpPluginCatalog = z.infer<typeof McpPluginCatalogSchema>;

export const PluginUnitStateSchema = z.object({
  unitId: McpPluginIdSchema,
  enabled: z.boolean(),
});
export type PluginUnitState = z.infer<typeof PluginUnitStateSchema>;

/** How one service's credential is satisfied, shared by every plugin server on that service:
 * `managed` delegates to the HQ broker; `local` names a daemon-local connector. */
export const PluginServiceBindingSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('managed') }),
  z.object({ type: z.literal('local'), connectorId: z.string().min(1) }),
]);
export type PluginServiceBinding = z.infer<typeof PluginServiceBindingSchema>;

export const PluginServiceBindingsSchema = z.partialRecord(
  McpPluginServiceSchema,
  PluginServiceBindingSchema,
);
export type PluginServiceBindings = z.infer<typeof PluginServiceBindingsSchema>;

export const PluginConnectorCredentialSchema = z.object({
  type: z.enum(['api-key', 'auth-token']),
  secret: z.string().min(1),
  expiresAt: TimestampSchema.optional(),
});
export type PluginConnectorCredential = z.infer<typeof PluginConnectorCredentialSchema>;

export const PluginConnectorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  service: McpPluginServiceSchema,
  credential: PluginConnectorCredentialSchema,
});
export type PluginConnector = z.infer<typeof PluginConnectorSchema>;

export const PluginConnectorPublicSchema = PluginConnectorSchema.omit({ credential: true }).extend({
  credential: z.object({
    type: z.enum(['api-key', 'auth-token']),
    configured: z.literal(true),
    expiresAt: TimestampSchema.optional(),
  }),
});
export type PluginConnectorPublic = z.infer<typeof PluginConnectorPublicSchema>;

export const PluginConfigSchema = z.object({
  units: z.array(PluginUnitStateSchema),
  serviceBindings: PluginServiceBindingsSchema,
  connectors: z.array(PluginConnectorSchema),
});
export type PluginConfig = z.infer<typeof PluginConfigSchema>;

export const PluginConfigPublicSchema = z.object({
  units: z.array(PluginUnitStateSchema),
  serviceBindings: PluginServiceBindingsSchema,
  connectors: z.array(PluginConnectorPublicSchema),
});
export type PluginConfigPublic = z.infer<typeof PluginConfigPublicSchema>;

export const PluginConnectorOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), connector: PluginConnectorSchema }),
  z.object({
    type: z.literal('update'),
    connectorId: z.string().min(1),
    label: z.string().min(1).nullable().optional(),
    credential: PluginConnectorCredentialSchema.optional(),
  }),
  z.object({ type: z.literal('delete'), connectorId: z.string().min(1) }),
]);
export type PluginConnectorOperation = z.infer<typeof PluginConnectorOperationSchema>;

export const PluginConfigSetSchema = z.object({
  units: z.array(PluginUnitStateSchema).optional(),
  serviceBindings: PluginServiceBindingsSchema.optional(),
  connectorOperations: z.array(PluginConnectorOperationSchema).optional(),
});
export type PluginConfigSet = z.infer<typeof PluginConfigSetSchema>;

export const PluginWarningReasonSchema = z.enum([
  'unsatisfied-binding',
  'unsupported-transport',
  'broker-unavailable',
  'expired-credential',
]);
export type PluginWarningReason = z.infer<typeof PluginWarningReasonSchema>;

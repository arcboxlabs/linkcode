import { zodResolver } from '@hookform/resolvers/zod';
import type {
  McpPluginDescriptor,
  McpPluginId,
  PluginConfigPublic,
  PluginConnectorOperation,
  PluginConnectorPublic,
  PluginUnitState,
} from '@linkcode/schema';
import type { PluginSavedConnectionView, PluginUnitSettingsView } from '@linkcode/ui';
import { PluginSettingsPanel } from '@linkcode/ui';
import { Alert, AlertDescription } from 'coss-ui/components/alert';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from 'coss-ui/components/alert-dialog';
import { Button } from 'coss-ui/components/button';
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from 'coss-ui/components/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Form } from 'coss-ui/components/form';
import { Input } from 'coss-ui/components/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { TriangleAlertIcon } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { rhfErrorsToFormErrors } from '../../lib/form';
import { usePluginSettings } from './hooks';
import { usePluginSettingsViewStore } from './store';

const connectionDraftSchema = z.object({
  label: z.string().trim().min(1),
  credentialType: z.enum(['api-key', 'auth-token']),
  secret: z.string(),
});
const newConnectionDraftSchema = connectionDraftSchema.extend({ secret: z.string().min(1) });
type ConnectionDraft = z.infer<typeof connectionDraftSchema>;

/** Empty secret means keep: never turn the masked read model into a credential write. */
export function pluginConnectorUpdate(
  connectorId: string,
  draft: ConnectionDraft,
): PluginConnectorOperation {
  return {
    type: 'update',
    connectorId,
    label: draft.label,
    ...(draft.secret !== '' && {
      credential: { type: draft.credentialType, secret: draft.secret },
    }),
  };
}

/** Transport-backed plugin settings container shared by desktop and webview. */
export function PluginsSettingsPanel(): React.ReactNode {
  const t = useTranslations('settings.plugins');
  const { catalog, config, error, isMutating, save } = usePluginSettings();
  const dialog = usePluginSettingsViewStore((state) => state.dialog);
  const addConnection = usePluginSettingsViewStore((state) => state.addConnection);
  const editConnection = usePluginSettingsViewStore((state) => state.editConnection);
  const removeConnection = usePluginSettingsViewStore((state) => state.removeConnection);
  const closeDialog = usePluginSettingsViewStore((state) => state.closeDialog);

  const connectorById = new Map(config?.connectors.map((connector) => [connector.id, connector]));
  const descriptorById = new Map(catalog?.map((descriptor) => [descriptor.id, descriptor]));
  const unitStateById = new Map(config?.units.map((unit) => [unit.unitId, unit]));
  const units = toUnitViews(catalog, config, t);
  const connections = toConnectionViews(config, t('connectionFallback'));
  const selectedConnector =
    dialog.kind === 'edit' || dialog.kind === 'remove'
      ? connectorById.get(dialog.connectorId)
      : undefined;

  const updateUnit = async (
    unitId: string,
    update: (current: PluginUnitState) => PluginUnitState,
  ): Promise<void> => {
    if (!catalog || !config) return;
    const typedUnitId = unitId as McpPluginId;
    const current = unitStateById.get(typedUnitId) ?? { unitId: typedUnitId, enabled: false };
    const next = update(current);
    const nextById = new Map(unitStateById).set(typedUnitId, next);
    await save({
      units: catalog.map(
        (descriptor) => nextById.get(descriptor.id) ?? { unitId: descriptor.id, enabled: false },
      ),
    });
  };

  const handleEnabledChange = (unitId: string, enabled: boolean): void => {
    const descriptor = descriptorById.get(unitId as McpPluginId);
    if (!descriptor) return;
    const current = unitStateById.get(unitId as McpPluginId);
    if (enabled && current?.binding === undefined) {
      const connection = config?.connectors.find(
        (connector) => connector.service === descriptor.service,
      );
      if (!connection && descriptor.service) {
        addConnection(descriptor.service, descriptor.id);
        return;
      }
      if (connection) {
        void updateUnit(unitId, (unit) => ({
          ...unit,
          enabled: true,
          binding: { type: 'local', connectorId: connection.id },
        }));
        return;
      }
    }
    void updateUnit(unitId, (unit) => ({ ...unit, enabled }));
  };

  const handleConnectionChange = (unitId: string, connectorId: string): void => {
    void updateUnit(unitId, (unit) => ({
      ...unit,
      binding: { type: 'local', connectorId },
    }));
  };

  return (
    <>
      <PluginSettingsPanel
        units={units}
        connections={connections}
        error={error === undefined ? undefined : (extractErrorMessage(error, false) ?? undefined)}
        busy={isMutating}
        onEnabledChange={handleEnabledChange}
        onConnectionChange={handleConnectionChange}
        onAddConnection={(unitId) => {
          const descriptor =
            unitId === undefined ? catalog?.at(0) : descriptorById.get(unitId as McpPluginId);
          if (descriptor?.service) {
            addConnection(descriptor.service, unitId === undefined ? undefined : descriptor.id);
          }
        }}
        onEditConnection={editConnection}
        onRemoveConnection={removeConnection}
      />

      {(dialog.kind === 'add' || dialog.kind === 'edit') && (
        <ConnectionDialog
          key={dialog.kind === 'add' ? `add:${dialog.service}` : `edit:${dialog.connectorId}`}
          connector={dialog.kind === 'edit' ? selectedConnector : undefined}
          busy={isMutating}
          onClose={closeDialog}
          onSubmit={async (draft) => {
            if (dialog.kind === 'add') {
              const connectorId = `plugin_${crypto.randomUUID()}`;
              await save({
                connectorOperations: [
                  {
                    type: 'create',
                    connector: {
                      id: connectorId,
                      label: draft.label,
                      service: dialog.service,
                      credential: { type: draft.credentialType, secret: draft.secret },
                    },
                  },
                ],
                ...(dialog.enableUnitId !== undefined && {
                  units: (catalog ?? []).map((descriptor) =>
                    descriptor.id === dialog.enableUnitId
                      ? {
                          unitId: descriptor.id,
                          enabled: true,
                          binding: { type: 'local' as const, connectorId },
                        }
                      : (unitStateById.get(descriptor.id) ?? {
                          unitId: descriptor.id,
                          enabled: false,
                        }),
                  ),
                }),
              });
            } else {
              await save({
                connectorOperations: [pluginConnectorUpdate(dialog.connectorId, draft)],
              });
            }
            closeDialog();
          }}
        />
      )}

      <AlertDialog
        open={dialog.kind === 'remove'}
        onOpenChange={(open) => {
          if (!open && !isMutating) closeDialog();
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('removeTitle', { name: selectedConnector?.label ?? t('connectionFallback') })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('removeDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline">{t('cancel')}</Button>} />
            <Button
              variant="destructive"
              disabled={isMutating || dialog.kind !== 'remove'}
              onClick={() => {
                if (dialog.kind !== 'remove') return;
                void save({
                  connectorOperations: [{ type: 'delete', connectorId: dialog.connectorId }],
                }).then(closeDialog);
              }}
            >
              {t('removeConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function ConnectionDialog({
  connector,
  busy,
  onClose,
  onSubmit,
}: {
  connector?: PluginConnectorPublic;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: ConnectionDraft) => Promise<void>;
}): React.ReactNode {
  const t = useTranslations('settings.plugins');
  const editing = connector !== undefined;
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ConnectionDraft>({
    resolver: zodResolver(editing ? connectionDraftSchema : newConnectionDraftSchema),
    defaultValues: {
      label: connector?.label ?? t('githubConnectionDefault'),
      credentialType: connector?.credential.type ?? 'auth-token',
      secret: '',
    },
  });

  const submit = handleSubmit(async (draft) => {
    try {
      await onSubmit(draft);
    } catch (error) {
      setError('root', {
        message: extractErrorMessage(error, false) ?? t('saveError'),
      });
    }
  });

  return (
    <Dialog
      open
      disablePointerDismissal={busy || isSubmitting}
      onOpenChange={(open) => {
        if (!open && !busy && !isSubmitting) onClose();
      }}
    >
      <DialogPopup closeProps={{ disabled: busy || isSubmitting }}>
        <Form errors={rhfErrorsToFormErrors(errors)} onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{editing ? t('editTitle') : t('addTitle')}</DialogTitle>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-4">
            {errors.root?.message === undefined ? null : (
              <Alert variant="error">
                <TriangleAlertIcon />
                <AlertDescription>{errors.root.message}</AlertDescription>
              </Alert>
            )}
            <Field name="label">
              <FieldLabel>{t('form.label')}</FieldLabel>
              <Input autoComplete="off" disabled={busy || isSubmitting} {...register('label')} />
              <FieldError />
            </Field>
            <Field name="credentialType">
              <FieldLabel>{t('form.credentialType')}</FieldLabel>
              <Controller
                control={control}
                name="credentialType"
                render={({ field }) => (
                  <Select
                    items={[
                      { value: 'auth-token', label: t('credentialType.auth-token') },
                      { value: 'api-key', label: t('credentialType.api-key') },
                    ]}
                    value={field.value}
                    disabled={editing || busy || isSubmitting}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="auth-token">{t('credentialType.auth-token')}</SelectItem>
                      <SelectItem value="api-key">{t('credentialType.api-key')}</SelectItem>
                    </SelectPopup>
                  </Select>
                )}
              />
            </Field>
            <Field name="secret">
              <FieldLabel>{t('form.secret')}</FieldLabel>
              <Input
                type="password"
                autoComplete="new-password"
                disabled={busy || isSubmitting}
                placeholder={editing ? t('form.secretKeepPlaceholder') : undefined}
                {...register('secret')}
              />
              <FieldDescription>
                {editing ? t('form.secretKeepHint') : t('form.secretHint')}
              </FieldDescription>
              <FieldError />
            </Field>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy || isSubmitting}
              onClick={onClose}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={busy || isSubmitting}>
              {editing ? t('save') : t('add')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}

function toUnitViews(
  catalog: McpPluginDescriptor[] | undefined,
  config: PluginConfigPublic | undefined,
  t: ReturnType<typeof useTranslations<'settings.plugins'>>,
): PluginUnitSettingsView[] | undefined {
  if (!catalog || !config) return undefined;
  const stateById = new Map(config.units.map((unit) => [unit.unitId, unit]));
  return catalog.map((descriptor) => {
    const state = stateById.get(descriptor.id);
    const matching = config.connectors.filter(
      (connector) => connector.service === descriptor.service,
    );
    return {
      id: descriptor.id,
      label: t(descriptor.labelKey),
      description: t(descriptor.descriptionKey),
      enabled: state?.enabled ?? false,
      ...(state?.binding?.type === 'local' && { connectionId: state.binding.connectorId }),
      connectionOptions: matching.map((connector) => ({
        id: connector.id,
        label: connector.label ?? t('connectionFallback'),
      })),
    };
  });
}

function toConnectionViews(
  config: PluginConfigPublic | undefined,
  fallbackLabel: string,
): PluginSavedConnectionView[] | undefined {
  return config?.connectors.map((connector) => ({
    id: connector.id,
    label: connector.label ?? fallbackLabel,
    credentialType: connector.credential.type,
  }));
}

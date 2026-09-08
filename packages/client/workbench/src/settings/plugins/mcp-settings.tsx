import { zodResolver } from '@hookform/resolvers/zod';
import type { CustomMcpServerPublic } from '@linkcode/schema';
import type { CustomMcpServerRow, PluginMcpServerRow } from '@linkcode/ui';
import { CustomServerList, PluginProvidedServers } from '@linkcode/ui';
import { Button } from 'coss-ui/components/button';
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from 'coss-ui/components/dialog';
import { Field, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Form } from 'coss-ui/components/form';
import { Input } from 'coss-ui/components/input';
import { RadioGroup, RadioGroupItem } from 'coss-ui/components/radio-group';
import { Textarea } from 'coss-ui/components/textarea';
import { noop } from 'foxts/noop';
import { Trash2Icon, UndoIcon } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { rhfErrorsToFormErrors } from '../../lib/form';
import type { CustomMcpServerDraft } from './custom-mcp-patch';
import { buildCustomMcpPatch } from './custom-mcp-patch';
import { useCustomMcpServers, useSetCustomMcpServers } from './hooks';

/** Client-minted identity for a new server (module scope: `Date.now` must not run in render). */
function mintCustomServer(): { id: string; createdAt: number } {
  return { id: `custom_${crypto.randomUUID()}`, createdAt: Date.now() };
}

const SecretRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  remove: z.boolean(),
});

const McpFormSchema = z
  .object({
    name: z.string().trim().min(1),
    transport: z.enum(['stdio', 'http']),
    command: z.string(),
    args: z.string(),
    url: z.string(),
    secrets: z.array(SecretRowSchema),
  })
  .superRefine((form, ctx) => {
    if (form.transport === 'stdio' && form.command.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['command'], message: 'required' });
    }
    if (form.transport === 'http' && form.url.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'required' });
    }
  });

type McpForm = z.infer<typeof McpFormSchema>;

type DialogState = { mode: 'closed' } | { mode: 'add' } | { mode: 'edit'; id: string };

export interface McpTabProps {
  pluginRows: PluginMcpServerRow[];
}

/** The MCP tab: editable LinkCode-owned servers on top, plugin-provided servers read-only below. */
export function McpTab({ pluginRows }: McpTabProps): React.ReactNode {
  const { data: servers, mutate } = useCustomMcpServers();
  const save = useSetCustomMcpServers();
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' });

  const rows = servers?.map((server) => customServerRow(server));
  const serversById = new Map((servers ?? []).map((server) => [server.id, server]));
  const editing = dialog.mode === 'edit' ? serversById.get(dialog.id) : undefined;

  const apply = async (patches: ReturnType<typeof buildCustomMcpPatch>): Promise<void> => {
    if (patches.length > 0) {
      await save.trigger({ patches });
      await mutate();
    }
    setDialog({ mode: 'closed' });
  };

  return (
    <div className="flex flex-col gap-6 pt-2">
      <CustomServerList
        rows={rows}
        busy={save.isMutating}
        onAdd={() => setDialog({ mode: 'add' })}
        onEdit={(id) => setDialog({ mode: 'edit', id })}
        onRemove={(id) => {
          void apply([{ op: 'remove', id }]).catch(noop);
        }}
        onToggle={(id, enabled) => {
          void apply([{ op: 'update', id, enabled }]).catch(noop);
        }}
      />
      <PluginProvidedServers rows={pluginRows} />
      {dialog.mode === 'closed' ? null : (
        <CustomServerDialog
          key={dialog.mode === 'edit' ? dialog.id : 'add'}
          previous={editing}
          busy={save.isMutating}
          onClose={() => setDialog({ mode: 'closed' })}
          onSubmit={(draft) => {
            void apply(buildCustomMcpPatch(maskOf(editing), draft, mintCustomServer())).catch(noop);
          }}
        />
      )}
    </div>
  );
}

/** The dialog edits against the masked projection — the same view the wire exposes. */
function maskOf(server: CustomMcpServerPublic | undefined): CustomMcpServerPublic | undefined {
  return server;
}

function customServerRow(server: CustomMcpServerPublic): CustomMcpServerRow {
  return {
    id: server.id,
    name: server.server.name,
    transport: server.server.type,
    detail: server.server.type === 'stdio' ? server.server.command : server.server.url,
    enabled: server.enabled,
    secretKeys: server.server.type === 'stdio' ? server.server.envKeys : server.server.headerKeys,
  };
}

function formDefaults(previous: CustomMcpServerPublic | undefined): McpForm {
  if (!previous) {
    return { name: '', transport: 'stdio', command: '', args: '', url: '', secrets: [] };
  }
  const { server } = previous;
  return {
    name: server.name,
    transport: server.type,
    command: server.type === 'stdio' ? server.command : '',
    args: server.type === 'stdio' ? (server.args ?? []).join('\n') : '',
    url: server.type === 'http' ? server.url : '',
    // Existing keys render with an EMPTY value: blank = keep, typed = replace, remove = delete.
    secrets: (server.type === 'stdio' ? server.envKeys : server.headerKeys).map((key) => ({
      key,
      value: '',
      remove: false,
    })),
  };
}

function CustomServerDialog({
  previous,
  busy,
  onClose,
  onSubmit,
}: {
  previous: CustomMcpServerPublic | undefined;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: CustomMcpServerDraft) => void;
}): React.ReactNode {
  const t = useTranslations('settings.plugins.mcp');
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<McpForm>({
    resolver: zodResolver(McpFormSchema),
    defaultValues: formDefaults(previous),
  });
  const secrets = useFieldArray({ control, name: 'secrets' });
  const transport = useWatch({ control, name: 'transport' });
  const existingKeyCount =
    previous === undefined
      ? 0
      : previous.server.type === 'stdio'
        ? previous.server.envKeys.length
        : previous.server.headerKeys.length;

  const submit = handleSubmit((form) => {
    const secretRows: Array<{ key: string; value: string; remove: boolean }> = [];
    for (let i = 0, len = form.secrets.length; i < len; i++) {
      const row = form.secrets[i];
      const key = row.key.trim();
      if (key !== '') secretRows.push({ key, value: row.value, remove: row.remove });
    }
    const args: string[] = [];
    const argLines = form.args.split('\n');
    for (let i = 0, len = argLines.length; i < len; i++) {
      const line = argLines[i];
      const trimmed = line.trim();
      if (trimmed !== '') args.push(trimmed);
    }
    onSubmit(
      form.transport === 'stdio'
        ? {
            type: 'stdio',
            name: form.name.trim(),
            command: form.command.trim(),
            args,
            secrets: secretRows,
          }
        : { type: 'http', name: form.name.trim(), url: form.url.trim(), secrets: secretRows },
    );
  });

  return (
    <Dialog open onOpenChange={(open) => open || onClose()}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{previous === undefined ? t('add') : t('edit')}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <Form
            className="flex flex-col gap-4"
            errors={rhfErrorsToFormErrors(errors)}
            onSubmit={submit}
          >
            <Field name="name">
              <FieldLabel>{t('form.name')}</FieldLabel>
              <Input {...register('name')} autoFocus />
              <FieldError />
            </Field>
            <Field>
              <FieldLabel>{t('form.transport')}</FieldLabel>
              {previous === undefined ? (
                <Controller
                  control={control}
                  name="transport"
                  render={({ field }) => (
                    <RadioGroup
                      className="gap-2"
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      {(['stdio', 'http'] as const).map((value) => (
                        <label key={value} className="flex cursor-pointer items-center gap-2.5">
                          <RadioGroupItem value={value} />
                          <span className="text-sm">
                            {value === 'stdio' ? t('transportStdio') : t('transportHttp')}
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  )}
                />
              ) : (
                <p className="text-muted-foreground text-xs">{t('form.transportLocked')}</p>
              )}
            </Field>
            {transport === 'stdio' ? (
              <>
                <Field name="command">
                  <FieldLabel>{t('form.command')}</FieldLabel>
                  <Input {...register('command')} placeholder="npx my-mcp-server" />
                  <FieldError />
                </Field>
                <Field>
                  <FieldLabel>{t('form.args')}</FieldLabel>
                  <Textarea {...register('args')} rows={2} />
                </Field>
              </>
            ) : (
              <Field name="url">
                <FieldLabel>{t('form.url')}</FieldLabel>
                <Input {...register('url')} placeholder="https://example.com/mcp" />
                <FieldError />
              </Field>
            )}
            {/* No <Field> wrapper here: base-ui Field supports ONE control, and a second
              InputPrimitive inside the same Field gets its `name` overwritten by the context
              (observed live: both row inputs rendered name="secrets.0.value"). */}
            <div className="flex flex-col gap-1.5">
              <p className="font-medium text-sm">
                {transport === 'stdio' ? t('form.secretsEnv') : t('form.secretsHeaders')}
              </p>
              <div className="flex flex-col gap-2">
                {secrets.fields.map((row, index) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <Input
                      {...register(`secrets.${index}.key`)}
                      className="w-40"
                      placeholder={t('form.secretKey')}
                      readOnly={index < existingKeyCount}
                    />
                    <Input
                      {...register(`secrets.${index}.value`)}
                      className="flex-1"
                      type="password"
                      placeholder={
                        index < existingKeyCount ? t('form.configured') : t('form.secretValue')
                      }
                    />
                    <Controller
                      control={control}
                      name={`secrets.${index}.remove`}
                      render={({ field }) =>
                        index < existingKeyCount ? (
                          <Button
                            type="button"
                            aria-label={
                              field.value ? t('form.restoreSecret') : t('form.removeSecret')
                            }
                            variant={field.value ? 'destructive' : 'ghost'}
                            size="icon-sm"
                            onClick={() => field.onChange(!field.value)}
                          >
                            {field.value ? (
                              <UndoIcon className="size-4" />
                            ) : (
                              <Trash2Icon className="size-4" />
                            )}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            aria-label={t('form.removeSecret')}
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => secrets.remove(index)}
                          >
                            <Trash2Icon className="size-4" />
                          </Button>
                        )
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => secrets.append({ key: '', value: '', remove: false })}
                >
                  {t('form.addSecret')}
                </Button>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t('form.cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('form.save')}
              </Button>
            </div>
          </Form>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

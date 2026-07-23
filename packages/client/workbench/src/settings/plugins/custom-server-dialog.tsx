import { zodResolver } from '@hookform/resolvers/zod';
import type { McpServer } from '@linkcode/schema';
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
import { Textarea } from 'coss-ui/components/textarea';
import { isObjectEmpty } from 'foxts/is-object-empty';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { rhfErrorsToFormErrors } from '../../lib/form';

const customServerDraftSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(/^[\w-]+$/, 'name'),
    transport: z.enum(['stdio', 'http']),
    command: z.string().trim().optional(),
    args: z.string().optional(),
    env: z.string().optional(),
    url: z.string().trim().optional(),
    headers: z.string().optional(),
  })
  .refine((draft) => draft.transport !== 'stdio' || (draft.command ?? '').length > 0, {
    path: ['command'],
  })
  .refine((draft) => draft.transport !== 'http' || (draft.url ?? '').length > 0, { path: ['url'] });

type CustomServerDraft = z.infer<typeof customServerDraftSchema>;

/** Parse `KEY=VALUE` (env) / `KEY: VALUE` (headers) lines into a record; blank lines ignored. */
function parsePairs(raw: string | undefined, separator: '=' | ':'): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of (raw ?? '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const at = trimmed.indexOf(separator);
    if (at <= 0) continue;
    pairs[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return pairs;
}

function draftToServer(draft: CustomServerDraft): McpServer {
  if (draft.transport === 'stdio') {
    const args = (draft.args ?? '').split(/\s+/).filter((part) => part.length > 0);
    const env = parsePairs(draft.env, '=');
    return {
      type: 'stdio',
      name: draft.name,
      command: draft.command ?? '',
      ...(args.length > 0 && { args }),
      ...(!isObjectEmpty(env) && { env }),
    };
  }
  const headers = parsePairs(draft.headers, ':');
  return {
    type: 'http',
    name: draft.name,
    url: draft.url ?? '',
    ...(!isObjectEmpty(headers) && { headers }),
  };
}

export interface CustomServerDialogProps {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves once the host acknowledges; a rejection keeps the dialog open with a root error. */
  onSubmit: (server: McpServer) => Promise<void>;
}

/** Add a user-imported MCP server. stdio → command/args/env; http → url/headers. */
export function CustomServerDialog({
  open,
  busy,
  onOpenChange,
  onSubmit,
}: CustomServerDialogProps): React.ReactNode {
  const t = useTranslations('settings.plugins');
  const {
    control,
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors },
  } = useForm<CustomServerDraft>({
    resolver: zodResolver(customServerDraftSchema),
    defaultValues: {
      name: '',
      transport: 'stdio',
      command: '',
      args: '',
      env: '',
      url: '',
      headers: '',
    },
  });
  const transport = watch('transport');

  const submit = handleSubmit(async (draft) => {
    try {
      await onSubmit(draftToServer(draft));
      reset();
      onOpenChange(false);
    } catch (error) {
      setError('root', { message: t('customSaveError') });
      throw error;
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup>
        <DialogPanel>
          <DialogHeader>
            <DialogTitle>{t('customAddTitle')}</DialogTitle>
          </DialogHeader>
          <Form
            id="custom-mcp-form"
            errors={rhfErrorsToFormErrors(errors)}
            onSubmit={submit}
            className="flex flex-col gap-4"
          >
            <Field name="name">
              <FieldLabel>{t('customForm.name')}</FieldLabel>
              <Input {...register('name')} placeholder="my-server" disabled={busy} />
              <FieldDescription>{t('customForm.nameHint')}</FieldDescription>
              <FieldError />
            </Field>
            <Controller
              control={control}
              name="transport"
              render={({ field }) => (
                <Field name="transport">
                  <FieldLabel>{t('customForm.transport')}</FieldLabel>
                  <Select
                    items={[
                      { value: 'stdio', label: t('customForm.transportStdio') },
                      { value: 'http', label: t('customForm.transportHttp') },
                    ]}
                    value={field.value}
                    disabled={busy}
                    onValueChange={(value) => {
                      if (value !== null) field.onChange(value);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="stdio">{t('customForm.transportStdio')}</SelectItem>
                      <SelectItem value="http">{t('customForm.transportHttp')}</SelectItem>
                    </SelectPopup>
                  </Select>
                </Field>
              )}
            />
            {transport === 'stdio' ? (
              <>
                <Field name="command">
                  <FieldLabel>{t('customForm.command')}</FieldLabel>
                  <Input {...register('command')} placeholder="npx" disabled={busy} />
                  <FieldError />
                </Field>
                <Field name="args">
                  <FieldLabel>{t('customForm.args')}</FieldLabel>
                  <Input {...register('args')} placeholder="-y my-mcp-server" disabled={busy} />
                </Field>
                <Field name="env">
                  <FieldLabel>{t('customForm.env')}</FieldLabel>
                  <Textarea
                    {...register('env')}
                    placeholder={'API_TOKEN=…\nREGION=us'}
                    rows={3}
                    disabled={busy}
                  />
                  <FieldDescription>{t('customForm.secretHint')}</FieldDescription>
                </Field>
              </>
            ) : (
              <>
                <Field name="url">
                  <FieldLabel>{t('customForm.url')}</FieldLabel>
                  <Input
                    {...register('url')}
                    placeholder="https://example.com/mcp"
                    disabled={busy}
                  />
                  <FieldError />
                </Field>
                <Field name="headers">
                  <FieldLabel>{t('customForm.headers')}</FieldLabel>
                  <Textarea
                    {...register('headers')}
                    placeholder={'Authorization: Bearer …'}
                    rows={3}
                    disabled={busy}
                  />
                  <FieldDescription>{t('customForm.secretHint')}</FieldDescription>
                </Field>
              </>
            )}
          </Form>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t('customCancel')}
            </Button>
            <Button type="submit" form="custom-mcp-form" disabled={busy}>
              {t('customAdd')}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

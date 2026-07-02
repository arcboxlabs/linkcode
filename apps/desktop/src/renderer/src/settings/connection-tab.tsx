import { Button } from 'coss-ui/components/button';
import { Field, FieldDescription, FieldLabel } from 'coss-ui/components/field';
import { Input } from 'coss-ui/components/input';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { useDesktopSettingsStore } from './store';

const daemonUrlSchema = z.url();

export function ConnectionTab(): React.ReactNode {
  const t = useTranslations('settings.connection');
  const daemonUrl = useDesktopSettingsStore((state) => state.daemonUrl);
  const daemonUrlOverride = useDesktopSettingsStore((state) => state.daemonUrlOverride);
  const setDaemonUrl = useDesktopSettingsStore((state) => state.setDaemonUrl);
  const [value, setValue] = useState(daemonUrlOverride ?? '');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed === '') {
          setError(null);
          setDaemonUrl(null);
          return;
        }
        const parsed = daemonUrlSchema.safeParse(trimmed);
        if (!parsed.success) {
          setError(t('invalidUrl'));
          return;
        }
        setError(null);
        setDaemonUrl(parsed.data);
      }}
    >
      <div>
        <h2 className="font-semibold text-sm">{t('title')}</h2>
        <p className="text-muted-foreground text-xs">{t('hint')}</p>
      </div>
      <Field>
        <FieldLabel>{t('url')}</FieldLabel>
        <Input
          className="w-full"
          value={value}
          placeholder={daemonUrl}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
        <FieldDescription>{t('urlHint')}</FieldDescription>
        {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={value.trim() === (daemonUrlOverride ?? '')}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

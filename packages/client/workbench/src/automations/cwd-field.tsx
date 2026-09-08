import { TaskSelect } from '@linkcode/ui';
import { Field, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Input } from 'coss-ui/components/input';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useWorkspaces } from '../workspace/hooks';

export function CwdField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const { data: workspaces } = useWorkspaces();
  const [custom, setCustom] = useState(false);
  const workspaceByCwd = new Map(workspaces?.map((workspace) => [workspace.cwd, workspace]));
  const showPath = custom || !workspaceByCwd.has(value);

  return (
    <Field name="cwd">
      <FieldLabel>{t('cwdLabel')}</FieldLabel>
      <TaskSelect
        value={showPath ? 'custom' : value}
        onChange={(next) => {
          setCustom(next === 'custom');
          if (next !== 'custom') onChange(next);
        }}
        items={[
          ...(workspaces ?? []).map((workspace) => ({
            value: workspace.cwd,
            label: workspace.name ?? workspace.cwd,
          })),
          { value: 'custom', label: t('customDirectory') },
        ]}
      />
      {showPath ? (
        <Input
          className="w-full"
          autoComplete="off"
          aria-label={t('directoryPath')}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
      <FieldError />
    </Field>
  );
}

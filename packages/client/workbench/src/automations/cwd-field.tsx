import { Field, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Input } from 'coss-ui/components/input';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { useWorkspaces } from '../workspace/hooks';

const CWD_OPTIONS_ID = 'automations-cwd-options';

/** Working-directory field with registered-workspace suggestions (MRU first), shared by both create forms. */
export function CwdField({ inputProps }: { inputProps: UseFormRegisterReturn }): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const { data: workspaces } = useWorkspaces();

  return (
    <Field name="cwd">
      <FieldLabel>{t('cwdLabel')}</FieldLabel>
      <Input
        className="w-full"
        autoComplete="off"
        placeholder="/path/to/repo"
        list={CWD_OPTIONS_ID}
        {...inputProps}
      />
      <datalist id={CWD_OPTIONS_ID}>
        {(workspaces ?? []).map((workspace) => (
          <option key={workspace.workspaceId} value={workspace.cwd}>
            {workspace.name}
          </option>
        ))}
      </datalist>
      <FieldError />
    </Field>
  );
}

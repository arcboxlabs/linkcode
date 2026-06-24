import type { FieldErrors, GlobalError } from 'react-hook-form';
import { useFormContext } from 'react-hook-form';

function getGlobalErrorMessage(
  error: (Record<string, GlobalError> & GlobalError) | GlobalError | undefined,
): string | undefined {
  return error?.message || undefined;
}

/**
 * Renders global `root` / `form` errors (API failures via `setError('root', …)`,
 * RHF `validate` rejections) from the surrounding `FormProvider` context. Place
 * it outside any `<Field>` — `<FieldError>` crashes without a parent `<Field>`,
 * which is why this standalone component exists.
 */
export function FormRootError({ errors: errorsProp }: { errors?: FieldErrors }) {
  const ctx = useFormContext();
  const errors = errorsProp ?? ctx.formState.errors;

  const rootMessage = getGlobalErrorMessage(errors.root);
  const formMessage = getGlobalErrorMessage(errors.form);

  if (!rootMessage && !formMessage) return null;

  return (
    <>
      {rootMessage && (
        <div data-slot="field-error" className="text-destructive-foreground text-xs">
          {rootMessage}
        </div>
      )}
      {formMessage && (
        <div data-slot="field-error" className="text-destructive-foreground text-xs">
          {formMessage}
        </div>
      )}
    </>
  );
}
